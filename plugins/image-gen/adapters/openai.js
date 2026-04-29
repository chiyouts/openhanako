import fs from "fs";
import path from "path";
import { saveImageToDir } from "../lib/download.js";

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const OPENAI_RATIO_TO_SIZE = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

function resolveProviderId(params, ctx) {
  return params.providerId || ctx.providerId || "openai";
}

export const openaiImageAdapter = {
  id: "openai",
  name: "OpenAI Image",
  types: ["image"],
  capabilities: {
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
    resolutions: [],
  },

  async checkAuth(ctx) {
    const providerId = resolveProviderId({}, ctx);
    try {
      const creds = await ctx.bus.request("provider:credentials", { providerId });
      if (creds.error || !creds.apiKey) {
        return { ok: false, message: creds.error || "API key is not configured" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  },

  async submit(params, ctx) {
    const providerId = resolveProviderId(params, ctx);
    const creds = await ctx.bus.request("provider:credentials", { providerId });
    if (creds.error || !creds.apiKey) {
      throw new Error(`Provider "${providerId}" is not configured with an API key.`);
    }

    const { apiKey, baseUrl } = creds;
    const modelId = params.model || ctx.config?.get?.("defaultImageModel")?.id || "gpt-image-1";

    const allDefaults = ctx.config?.get?.("providerDefaults") || {};
    const providerDefaults = allDefaults[providerId] || allDefaults.openai || {};

    const outputFormat = params.format || providerDefaults?.format || "jpeg";
    const effectiveRatio = params.aspect_ratio || params.aspectRatio || providerDefaults?.aspect_ratio;
    const body = {
      model: modelId,
      prompt: params.prompt,
      n: 1,
      output_format: outputFormat,
    };

    if (params.size) {
      body.size = params.size;
    } else if (effectiveRatio && OPENAI_RATIO_TO_SIZE[effectiveRatio]) {
      body.size = OPENAI_RATIO_TO_SIZE[effectiveRatio];
    } else if (providerDefaults?.size) {
      body.size = providerDefaults.size;
    }

    const quality = params.quality || providerDefaults?.quality;
    if (quality) body.quality = quality;

    if (providerDefaults?.background) body.background = providerDefaults.background;

    if (params.image) {
      const images = Array.isArray(params.image) ? params.image : [params.image];
      body.image = images.map((img) => {
        if (path.isAbsolute(img) && fs.existsSync(img)) {
          const buffer = fs.readFileSync(img);
          const ext = path.extname(img).slice(1).toLowerCase();
          const mime = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp",
          }[ext] || "image/png";
          return `data:${mime};base64,${buffer.toString("base64")}`;
        }
        return img;
      });
    }

    const base = baseUrl.replace(/\/+$/, "");
    const endpoint = body.image
      ? `${base}/images/edits`
      : `${base}/images/generations`;

    const startedAt = Date.now();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(61_000),
    }).catch((err) => {
      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        throw new Error(
          `API error timeout from provider "${providerId}" model "${modelId}"\nendpoint: ${endpoint}\nduration: after ${Date.now() - startedAt}ms`,
        );
      }
      throw err;
    });

    if (!res.ok) {
      let msg = `API error ${res.status} from provider "${providerId}" model "${modelId}"\nendpoint: ${endpoint}\nduration: after ${Date.now() - startedAt}ms`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}\n\n${err.error.message}`;
      } catch {
        const text = await res.text().catch(() => "");
        if (text) msg = `${msg}\n\n${text}`;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const responseImages = data.data || [];
    if (responseImages.length === 0) {
      throw new Error("API returned no images");
    }

    const revisedPrompt = responseImages[0]?.revised_prompt;
    if (revisedPrompt) {
      ctx.log?.info?.(`[openai-image] revised_prompt: ${revisedPrompt}`);
    }

    const mimeType = FORMAT_TO_MIME[outputFormat] || "image/png";
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const files = [];

    for (let i = 0; i < responseImages.length; i += 1) {
      const buffer = Buffer.from(responseImages[i].b64_json, "base64");
      const customName = params.filename
        ? (responseImages.length > 1 ? `${params.filename}-${i + 1}` : params.filename)
        : null;
      const { filename } = await saveImageToDir(buffer, mimeType, ctx.generatedDir, customName);
      files.push(filename);
    }

    return { taskId, files };
  },
};
