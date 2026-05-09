// plugins/image-gen/adapters/openai-codex.js
import fs from "fs";
import path from "path";
import { saveImageToDir } from "../lib/download.js";

const PROVIDER_ID = "openai-codex-oauth";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_RESPONSES_MODEL = "gpt-5.5";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const RATIO_TO_SIZE = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

function resolveCodexResponsesUrl(baseUrl) {
  const raw = (baseUrl || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
  if (raw.endsWith("/codex/responses")) return raw;
  if (raw.endsWith("/codex")) return `${raw}/responses`;
  return `${raw}/codex/responses`;
}

function localImageToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }[ext] || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function normalizeImages(image) {
  if (!image) return [];
  const images = Array.isArray(image) ? image : [image];
  return images.map((img) => {
    if (typeof img === "string" && path.isAbsolute(img) && fs.existsSync(img)) {
      return localImageToDataUrl(img);
    }
    return img;
  }).filter(Boolean);
}

function collectImageResults(data) {
  const results = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    if (value.type === "image_generation_call" && typeof value.result === "string") {
      results.push(value.result);
      return;
    }
    if (typeof value.b64_json === "string") {
      results.push(value.b64_json);
      return;
    }
    visit(value.output);
    visit(value.content);
  };
  visit(data?.output || data?.response?.output || data);
  return results;
}

function extractAccountIdFromToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    return typeof accountId === "string" ? accountId : "";
  } catch {
    return "";
  }
}

function resolveResponsesModel(params, providerDefaults) {
  if (params.responsesModel) return params.responsesModel;
  if (providerDefaults?.responsesModel) return providerDefaults.responsesModel;
  if (providerDefaults?.mainlineModel) return providerDefaults.mainlineModel;
  return DEFAULT_RESPONSES_MODEL;
}

async function getCredentials(ctx) {
  const creds = await ctx.bus.request("provider:credentials", { providerId: PROVIDER_ID });
  if (creds.error || !creds.apiKey) {
    throw new Error(`Provider "${PROVIDER_ID}" is not signed in. Please sign in to OpenAI Codex in Settings > Providers first.`);
  }
  const accountId = creds.accountId || extractAccountIdFromToken(creds.apiKey);
  if (!accountId) {
    throw new Error(`Provider "${PROVIDER_ID}" missing ChatGPT account id. Please log in again.`);
  }
  return { ...creds, accountId };
}

export const openaiCodexImageAdapter = {
  id: PROVIDER_ID,
  name: "OpenAI Codex (OAuth)",
  types: ["image"],
  capabilities: {
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
    resolutions: [],
  },

  async checkAuth(ctx) {
    try {
      await getCredentials(ctx);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  },

  async submit(params, ctx) {
    const creds = await getCredentials(ctx);
    const allDefaults = ctx.config?.get?.("providerDefaults") || {};
    const providerDefaults = allDefaults[PROVIDER_ID] || {};
    const outputFormat = params.format || providerDefaults?.format || "png";
    const effectiveRatio = params.aspect_ratio || params.aspectRatio || params.ratio || providerDefaults?.aspect_ratio;

    const tool = {
      type: "image_generation",
      output_format: outputFormat,
    };
    if (params.size) {
      tool.size = params.size;
    } else if (effectiveRatio && RATIO_TO_SIZE[effectiveRatio]) {
      tool.size = RATIO_TO_SIZE[effectiveRatio];
    } else if (providerDefaults?.size) {
      tool.size = providerDefaults.size;
    }

    const quality = params.quality || providerDefaults?.quality;
    if (quality) tool.quality = quality;
    if (providerDefaults?.background) tool.background = providerDefaults.background;

    const content = [{ type: "input_text", text: params.prompt }];
    for (const imageUrl of normalizeImages(params.image)) {
      content.push({ type: "input_image", image_url: imageUrl });
    }

    const body = {
      model: resolveResponsesModel(params, providerDefaults),
      store: false,
      stream: false,
      instructions: "Generate or edit the requested image and return the image result.",
      input: [{ role: "user", content }],
      tools: [tool],
      tool_choice: "auto",
      parallel_tool_calls: false,
    };

    const res = await fetch(resolveCodexResponsesUrl(creds.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${creds.apiKey}`,
        "chatgpt-account-id": creds.accountId,
        "OpenAI-Beta": "responses=experimental",
        "originator": "pi",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}: ${err.error.message}`;
        else if (err.detail) msg = `${msg}: ${err.detail}`;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    const images = collectImageResults(data);
    if (images.length === 0) {
      throw new Error("API returned no images");
    }

    const mimeType = FORMAT_TO_MIME[outputFormat] || "image/png";
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const files = [];
    for (let i = 0; i < images.length; i++) {
      const buffer = Buffer.from(images[i], "base64");
      const customName = params.filename
        ? (images.length > 1 ? `${params.filename}-${i + 1}` : params.filename)
        : null;
      const { filename } = await saveImageToDir(buffer, mimeType, ctx.generatedDir, customName);
      files.push(filename);
    }

    return { taskId, files };
  },
};
