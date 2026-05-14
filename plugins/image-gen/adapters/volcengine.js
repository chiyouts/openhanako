import fs from "fs";
import path from "path";
import { saveImageToDir } from "../lib/download.js";
import { resolveModelId } from "../lib/model-catalog.js";

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const SIZE_TABLE = {
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "16:9": "2848x1600",
    "9:16": "1600x2848",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "3136x1344",
  },
  "4K": {
    "1:1": "4096x4096",
    "4:3": "3456x2592",
    "3:4": "2592x3456",
    "16:9": "4096x2304",
    "9:16": "2304x4096",
    "3:2": "3744x2496",
    "2:3": "2496x3744",
    "21:9": "4704x2016",
  },
};

function resolveSize(size, aspectRatio, providerDefaults) {
  const effectiveRatio = aspectRatio || providerDefaults?.aspect_ratio;
  const effectiveSize = size || providerDefaults?.size || "2K";

  if (effectiveRatio) {
    const tier = SIZE_TABLE[effectiveSize.toUpperCase()] || SIZE_TABLE["2K"];
    return tier[effectiveRatio] || effectiveSize;
  }
  return effectiveSize;
}

async function resolveVolcengineCredentials(ctx) {
  const primary = await ctx.bus.request("provider:credentials", { providerId: "volcengine" });
  if (!primary.error && primary.apiKey) return primary;

  const coding = await ctx.bus.request("provider:credentials", { providerId: "volcengine-coding" });
  if (!coding.error && coding.apiKey) return coding;

  return {
    error: primary.error || coding.error || "no_credentials",
  };
}

export const volcengineImageAdapter = {
  id: "volcengine",
  name: "Volcengine Seedream",
  types: ["image"],
  capabilities: {
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    resolutions: ["2k", "4k"],
  },

  async checkAuth(ctx) {
    try {
      const creds = await resolveVolcengineCredentials(ctx);
      if (creds.error || !creds.apiKey) {
        return { ok: false, message: creds.error || "API key is not configured" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  },

  async submit(params, ctx) {
    const creds = await resolveVolcengineCredentials(ctx);
    if (creds.error || !creds.apiKey) {
      throw new Error('Provider "volcengine" API key is not configured. Configure it in Settings -> Providers.');
    }

    const { apiKey, baseUrl } = creds;
    const rawModel = params.model || ctx.config?.get?.("defaultImageModel")?.id;
    const modelId = resolveModelId("volcengine", rawModel);

    const allDefaults = ctx.config?.get?.("providerDefaults") || {};
    const providerDefaults = allDefaults.volcengine || {};

    const outputFormat = params.format || providerDefaults?.format || "jpeg";
    const body = {
      model: modelId,
      prompt: params.prompt,
      response_format: "b64_json",
      output_format: outputFormat,
      size: resolveSize(params.size, params.aspect_ratio || params.aspectRatio, providerDefaults),
    };

    if (params.image) {
      const images = Array.isArray(params.image) ? params.image : [params.image];
      body.image = await Promise.all(images.map(async (img) => {
        if (path.isAbsolute(img) && fs.existsSync(img)) {
          const buffer = await fs.promises.readFile(img);
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
      }));
    }

    body.watermark = providerDefaults?.watermark ?? false;
    if (providerDefaults?.guidance_scale !== undefined) body.guidance_scale = providerDefaults.guidance_scale;
    if (providerDefaults?.seed !== undefined) body.seed = providerDefaults.seed;

    const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}: ${err.error.message}`;
      } catch {
        // ignore parse errors
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const responseImages = data.data || [];
    if (responseImages.length === 0) {
      throw new Error("API returned no images");
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
