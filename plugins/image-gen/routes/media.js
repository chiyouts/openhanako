import fs from "fs";
import path from "path";
import {
  findGeneratedFile,
  recordOutputDirHistory,
  resolveGeneratedDir,
  validateOutputDir,
} from "../lib/generated-dir.js";
import { isOpenAIImageProvider, isVolcengineImageProvider } from "../lib/provider-resolution.js";

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

const KNOWN_IMAGE_MODELS = {
  volcengine: [
    { id: "doubao-seedream-3-0-t2i", name: "Seedream 3.0" },
    { id: "doubao-seedream-4-0-250828", name: "Seedream 4.0" },
    { id: "doubao-seedream-4-5-251128", name: "Seedream 4.5" },
    { id: "doubao-seedream-5-0-lite-260128", name: "Seedream 5.0 Lite" },
  ],
  openai: [
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gpt-image-1", name: "GPT Image 1" },
    { id: "gpt-image-1.5", name: "GPT Image 1.5" },
    { id: "gpt-image-1-mini", name: "GPT Image 1 Mini" },
    { id: "dall-e-3", name: "DALL-E 3" },
  ],
  "openai-codex-oauth": [
    { id: "gpt-image-2", name: "GPT Image 2" },
  ],
};

function streamPipe(nodeStream, writable) {
  const writer = writable.getWriter();
  nodeStream.on("data", (chunk) => writer.write(chunk));
  nodeStream.on("end", () => writer.close());
  nodeStream.on("error", () => writer.close());
}

function catalogKeyForProvider(entry) {
  if (!entry) return null;
  if (entry.id === "openai-codex-oauth") return "openai-codex-oauth";
  if (isVolcengineImageProvider(entry)) return "volcengine";
  if (entry.id === "openai") return "openai";
  if (!entry.isBuiltin && isOpenAIImageProvider(entry)) return "openai";
  return null;
}

export default function registerMediaRoutes(app, ctx) {
  app.get("/media/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return c.json({ error: "invalid filename" }, 400);
    }

    const filePath = findGeneratedFile(ctx, filename);
    if (!filePath) {
      return c.json({ error: "not found" }, 404);
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return c.json({ error: "not found" }, 404);
    }

    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const total = stat.size;
    const range = c.req.header("range");

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : total - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      const { readable, writable } = new TransformStream();
      streamPipe(stream, writable);

      return new Response(readable, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const stream = fs.createReadStream(filePath);
    const { readable, writable } = new TransformStream();
    streamPipe(stream, writable);

    return new Response(readable, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  app.get("/providers", async (c) => {
    try {
      const providerList = await ctx.bus.request("provider:list").catch(() => ({ providers: [] }));
      const imageModelsResult = await ctx.bus.request("provider:models-by-type", { type: "image" });
      const providerEntries = providerList.providers || [];
      const imageModels = imageModelsResult.models || [];

      const grouped = {};
      const providerIndex = new Map(providerEntries.map((entry) => [entry.id, entry]));

      for (const entry of providerEntries) {
        const catalogKey = catalogKeyForProvider(entry);
        if (!catalogKey) continue;
        grouped[entry.id] = {
          providerId: entry.id,
          displayName: entry.displayName || entry.id,
          hasCredentials: false,
          models: [],
          availableModels: [...KNOWN_IMAGE_MODELS[catalogKey]],
          api: entry.api || "",
          baseUrl: entry.baseUrl || "",
        };
      }

      for (const model of imageModels) {
        const entry = providerIndex.get(model.provider);
        const catalogKey = catalogKeyForProvider(entry);
        if (!grouped[model.provider]) {
          grouped[model.provider] = {
            providerId: model.provider,
            displayName: entry?.displayName || model.provider,
            hasCredentials: false,
            models: [],
            availableModels: catalogKey ? [...KNOWN_IMAGE_MODELS[catalogKey]] : [],
            api: entry?.api || "",
            baseUrl: entry?.baseUrl || "",
          };
        }
        grouped[model.provider].models.push({ id: model.id, name: model.name || model.id });
      }

      for (const providerId of Object.keys(grouped)) {
        const creds = await ctx.bus.request("provider:credentials", { providerId }).catch(() => ({ error: "no_credentials" }));
        grouped[providerId].hasCredentials = !creds?.error;

        const entry = providerIndex.get(providerId);
        const catalogKey = catalogKeyForProvider(entry);
        const catalog = catalogKey ? KNOWN_IMAGE_MODELS[catalogKey] || [] : [];
        const addedIds = new Set(grouped[providerId].models.map((model) => model.id));
        grouped[providerId].availableModels = catalog.filter((model) => !addedIds.has(model.id));
      }

      return c.json({
        providers: grouped,
        config: {
          ...(ctx.config.get() || {}),
          resolvedOutputDir: resolveGeneratedDir(ctx),
        },
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/config", async (c) => {
    try {
      const body = await c.req.json();
      const next = { ...(body || {}) };
      const agentId = c.req.query("agentId") || undefined;

      if (Object.prototype.hasOwnProperty.call(next, "outputDir")) {
        const previousDir = resolveGeneratedDir(ctx);
        const validation = await validateOutputDir(ctx, next.outputDir, { agentId });
        if (!validation.ok) {
          return c.json({ error: validation.error }, 400);
        }

        const defaultDir = path.join(ctx.dataDir, "generated");
        const nextValue = validation.outputDir === defaultDir ? undefined : validation.outputDir;
        ctx.config.set("outputDir", nextValue);
        recordOutputDirHistory(ctx, previousDir, validation.outputDir);
        delete next.outputDir;
      }

      for (const [key, value] of Object.entries(next)) {
        ctx.config.set(key, value);
      }

      return c.json({
        ok: true,
        config: {
          ...(ctx.config.get() || {}),
          resolvedOutputDir: resolveGeneratedDir(ctx),
        },
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });
}
