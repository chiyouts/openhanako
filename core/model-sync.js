/**
 * model-sync.js 鈥?added-models.yaml 鈫?models.json 鍗曞悜鎶曞奖
 *
 * 绯荤粺涓敮涓€鍐?models.json 鐨勫湴鏂广€備粠 providers 閰嶇疆锛坰nake_case锛?
 * 鎶曞奖涓?Pi SDK 鏍煎紡锛坈amelCase锛夛紝闄勫姞 known-models.json 鍏冩暟鎹€?
 */

import fs from "fs";
import { getPiModel } from "../lib/pi-sdk/index.js";
import { lookupKnown } from "../shared/known-models.js";
import { normalizeVisionCapabilities, withHanaVideoInputCompat, withThinkingFormatCompat } from "../shared/model-capabilities.js";
import { providerCredentialAllowsMissingApiKey } from "../shared/provider-auth.js";
import { isLocalBaseUrl } from "../shared/net-utils.js";
import { validateProviderModels } from "../shared/provider-model-validation.js";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const PI_BUILTIN_PROVIDER_REUSE = new Set(["kimi-coding"]);
const KNOWN_OPENAI_COMPAT_PROVIDER_IDS = new Set([
  "openai",
  "deepseek",
  "gemini",
  "openrouter",
  "ollama",
  "minimax",
  "siliconflow",
  "zhipu",
  "moonshot",
  "baichuan",
  "stepfun",
  "volcengine",
  "hunyuan",
  "baidu-cloud",
  "modelscope",
  "infini",
  "mimo",
  "groq",
  "together",
  "fireworks",
  "mistral",
  "perplexity",
  "xai",
  "dashscope",
  "dashscope-coding",
  "kimi-coding",
  "volcengine-coding",
]);

function isOfficialOpenAIBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

function needsConservativeCompat({ provider, baseUrl, api, isBuiltin }) {
  const isOpenAIApi = api === "openai-completions"
    || api === "openai-responses"
    || api === "openai-codex-responses";
  if (!isOpenAIApi) return false;

  if (provider === "openai") {
    return !!baseUrl && !isLocalBaseUrl(baseUrl) && !isOfficialOpenAIBaseUrl(baseUrl);
  }

  if (isBuiltin) return false;
  return !KNOWN_OPENAI_COMPAT_PROVIDER_IDS.has(provider);
}
/**
 * 妯″瀷 ID 鈫?浜虹被鍙鍚?
 * "doubao-seed-2-0-pro-260215" 鈫?"Doubao Seed 2.0 Pro"
 */
function humanizeName(id) {
  let name = id.replace(/-(\d{6})$/, "");
  name = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  name = name.replace(/(\d) (\d)/g, "$1.$2");
  return name;
}

/** 浠?auth.json entry 鎻愬彇 API key锛堝吋瀹瑰绉嶆牸寮忥級 */
function extractApiKey(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry?.apiKey === "string") return entry.apiKey;
  if (typeof entry?.access === "string") return entry.access;
  if (typeof entry?.token === "string") return entry.token;
  return "";
}

function getModelId(modelEntry) {
  return typeof modelEntry === "object" && modelEntry !== null ? modelEntry.id : modelEntry;
}

function buildPiInputModalities({ image = false } = {}) {
  return [
    "text",
    ...(image ? ["image"] : []),
  ];
}

function getPiBuiltinModel(provider, modelId) {
  if (!PI_BUILTIN_PROVIDER_REUSE.has(provider) || !modelId) return null;
  try {
    return getPiModel(provider, modelId) || null;
  } catch {
    return null;
  }
}

function shouldReusePiBuiltinModel(provider, modelId, api) {
  return api === "anthropic-messages" && !!getPiBuiltinModel(provider, modelId);
}

function buildModelOverride(modelEntry) {
  if (typeof modelEntry !== "object" || modelEntry === null) return null;

  const override = {};
  if (modelEntry.name !== undefined) override.name = modelEntry.name;
  if (modelEntry.context !== undefined) override.contextWindow = modelEntry.context;
  if (modelEntry.contextWindow !== undefined) override.contextWindow = modelEntry.contextWindow;
  if (modelEntry.maxOutput !== undefined) override.maxTokens = modelEntry.maxOutput;
  if (modelEntry.maxTokens !== undefined) override.maxTokens = modelEntry.maxTokens;
  const image = modelEntry.image ?? modelEntry.vision;
  const video = modelEntry.video;
  if (image !== undefined || video !== undefined) {
    override.input = buildPiInputModalities({
      image: image === true,
    });
  }
  if (modelEntry.reasoning !== undefined) override.reasoning = modelEntry.reasoning;

  const finalOverride = video === true ? withHanaVideoInputCompat(override, true) : override;
  return Object.keys(finalOverride).length > 0 ? finalOverride : null;
}

/**
 * 鏋勫缓鍗曚釜妯″瀷鐨?Pi SDK 鏍煎紡鏉＄洰
 * @param {string|{id:string, name?:string, context?:number, maxOutput?:number}} modelEntry
 * @param {string} provider - provider 鍚嶇О锛堟煡璇嶅吀鐢級
 */
function buildModelEntry(modelEntry, provider, baseUrl = "", api = "openai-completions", { isBuiltin = false } = {}) {
  const isObj = typeof modelEntry === "object" && modelEntry !== null;
  const id = getModelId(modelEntry);
  const known = lookupKnown(provider, id);
  const piBuiltin = getPiBuiltinModel(provider, id);

  // 杈撳叆妯℃€佽兘鍔涳細鐢ㄦ埛璁剧疆 > known-models 璇嶅吀 > 榛樿 false
  // 鍏煎璇伙細migration #7 涔嬪墠鐨勬棫鏁版嵁鐢?vision 瀛楁锛涗袱涓増鏈悗绉婚櫎 vision fallback
  const userImage = isObj ? (modelEntry.image ?? modelEntry.vision) : undefined;
  const knownImage = known?.image ?? known?.vision;
  const image = userImage !== undefined ? userImage : (knownImage === true);
  const userVideo = isObj ? modelEntry.video : undefined;
  const knownVideo = known?.video;
  const video = userVideo !== undefined ? userVideo : (knownVideo === true);
  const entry = {
    id,
    name: (isObj && modelEntry.name) || known?.name || humanizeName(id),
    input: buildPiInputModalities({ image: image === true }),
    contextWindow: (isObj && modelEntry.context) || known?.context || DEFAULT_CONTEXT_WINDOW,
    reasoning: (isObj && modelEntry.reasoning !== undefined) ? modelEntry.reasoning : (known?.reasoning === true),
  };

  const maxOutput = (isObj && modelEntry.maxOutput) || known?.maxOutput;
  if (maxOutput) entry.maxTokens = maxOutput;

  if (known?.quirks?.length) entry.quirks = known.quirks;
  if (piBuiltin?.headers) entry.headers = { ...piBuiltin.headers };

  const rawVisionCapabilities = isObj && modelEntry.visionCapabilities !== undefined
    ? modelEntry.visionCapabilities
    : known?.visionCapabilities;
  const visionCapabilities = image ? normalizeVisionCapabilities(rawVisionCapabilities) : null;
  if (visionCapabilities) entry.visionCapabilities = visionCapabilities;

  // Pi SDK compat 瑕嗙洊锛?
  // 1. 闈?OpenAI provider 涓嶅彂 developer role锛坉ashscope 绛変笉鏀寔锛夆€?涓?reasoning 鏃犲叧
  // 2. thinkingFormat 鐢?shared/model-capabilities.js 缁熶竴娲剧敓锛岄伩鍏嶈姹傚眰鎸?provider 鐚?
  // 3. Gemini OpenAI 鍏煎灞傦紙/v1beta/openai锛変弗鏍兼牎楠岋紝涓嶈瘑鍒?store 瀛楁浼?400銆?
  //    Native google-generative-ai 涓嶈蛋 Chat Completions锛屼笉闇€瑕佽繖缁?OpenAI 瀛楁鍏煎銆?
  if (provider !== "openai") {
    const compat = { supportsDeveloperRole: false };
    if (api === "openai-completions" && (
      provider === "gemini"
      || baseUrl.includes("generativelanguage.googleapis.com")
    )) {
      compat.supportsStore = false;
    }
    entry.compat = compat;
  }

  if (needsConservativeCompat({ provider, baseUrl, api, isBuiltin })) {
    entry.compat = {
      ...(entry.compat || {}),
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsUsageInStreaming: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
    };
  }

  const videoAwareEntry = video === true ? withHanaVideoInputCompat(entry, true) : entry;
  return withThinkingFormatCompat(videoAwareEntry, { provider, api, baseUrl });
}

function filterChatModelEntries(provider, models) {
  return models.filter(m => {
    const isObj = typeof m === "object" && m !== null;
    const id = getModelId(m);
    const known = lookupKnown(provider, id);
    const type = (isObj && m.type) || known?.type || "chat";
    return type === "chat";
  });
}

/**
 * 单向投影：providers 配置 → models.json（Pi SDK 格式）
 *
 * @param {Record<string, object>} providers - added-models.yaml 中的 providers 块（snake_case）
 * @param {object} [opts]
 * @param {string} opts.modelsJsonPath - models.json 输出路径
 * @param {string} [opts.authJsonPath] - auth.json 路径（OAuth 凭证查找用）
 * @param {Record<string, string>} [opts.oauthKeyMap] - providerId → auth.json key 映射
 * @returns {boolean} 内容是否有变化
 */
export function syncModels(providers, opts = {}) {
  const modelsJsonPath = opts.modelsJsonPath;
  const authJsonPath = opts.authJsonPath;
  const oauthKeyMap = opts.oauthKeyMap || {};
  const chatProjectionMap = opts.chatProjectionMap || {};

  // 鎳掑姞杞?auth.json锛堝彧鍦ㄩ渶瑕佹椂璇讳竴娆★級
  let _authJson;
  function getAuthJson() {
    if (_authJson !== undefined) return _authJson;
    if (!authJsonPath) { _authJson = {}; return _authJson; }
    try {
      _authJson = JSON.parse(fs.readFileSync(authJsonPath, "utf-8")) || {};
    } catch {
      _authJson = {};
    }
    return _authJson;
  }

  // 鏋勫缓鏂扮殑 providers 鍧?
  const newProviders = {};

  for (const [name, p] of Object.entries(providers || {})) {
    const projection = chatProjectionMap[name] || "models-json";
    if (projection === "sdk-auth-alias" || projection === "none") continue;
    if (!p.base_url) continue;
    if (!p.models || p.models.length === 0) continue;
    validateProviderModels(name, p.models, { baseUrl: p.base_url });

    let apiKey = p.api_key || "";

    // 鏃?api_key 鏃跺皾璇?OAuth 鏌ユ壘
    if (!apiKey) {
      const authKey = oauthKeyMap[name] || name;
      apiKey = extractApiKey(getAuthJson()[authKey]);
    }

    // 鏃犲嚟璇佹椂鍙厑璁?provider 濂戠害澹版槑鏃犻渶 key锛屾垨鏃ф湰鍦?loopback 閰嶇疆銆?
    if (!apiKey && !providerCredentialAllowsMissingApiKey({
      authType: p.auth_type,
      baseUrl: p.base_url,
    })) continue;

    const effectiveApiKey = apiKey || "local";
    const effectiveApi = p.api || "openai-completions";
    const chatModels = filterChatModelEntries(name, p.models);
    const customModels = [];
    const modelOverrides = {};

    for (const modelEntry of chatModels) {
      const id = getModelId(modelEntry);
      if (shouldReusePiBuiltinModel(name, id, effectiveApi)) {
        const override = buildModelOverride(modelEntry);
        if (override) modelOverrides[id] = override;
        continue;
      }
      customModels.push(buildModelEntry(modelEntry, name, p.base_url, effectiveApi, { isBuiltin: p._isBuiltin === true }));
    }

    const providerConfig = {
      baseUrl: p.base_url,
      api: effectiveApi,
      apiKey: effectiveApiKey,
    };
    if (customModels.length > 0) providerConfig.models = customModels;
    if (Object.keys(modelOverrides).length > 0) providerConfig.modelOverrides = modelOverrides;

    newProviders[name] = providerConfig;
  }

  const newJson = { providers: newProviders };
  const newStr = JSON.stringify(newJson, null, 4) + "\n";

  // 姣旇緝鏄惁鏈夊彉鍖?
  let oldStr = "";
  try {
    oldStr = fs.readFileSync(modelsJsonPath, "utf-8");
  } catch {
    // 鏂囦欢涓嶅瓨鍦紝瑙嗕负鏈夊彉鍖?
  }
  if (oldStr === newStr) return false;

  // 鍘熷瓙鍐欏叆锛氬厛鍐?tmp 鏂囦欢锛屽啀 rename
  const tmpPath = modelsJsonPath + ".tmp";
  fs.writeFileSync(tmpPath, newStr, "utf-8");
  fs.renameSync(tmpPath, modelsJsonPath);

  return true;
}
