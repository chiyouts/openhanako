/**
 * Generic output budget normalization.
 *
 * This module only handles provider-independent request policy. Provider wire
 * details stay in provider-compat/<provider>.js modules.
 */

const SDK_IMPLICIT_MAX_TOKENS_CAP = 32000;
const OUTPUT_CAP_FIELDS = [
  "max_completion_tokens",
  "max_tokens",
  "max_output_tokens",
  "maxOutputTokens",
];

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getModelOutputLimit(model) {
  return positiveInteger(model?.maxTokens || model?.maxOutput);
}

function isOfficialDeepSeekEndpoint(model) {
  const provider = lower(model?.provider);
  const baseUrl = lower(model?.baseUrl || model?.base_url);
  return provider === "deepseek" || baseUrl.includes("api.deepseek.com");
}

function requiresOutputCap(model) {
  if (!model || typeof model !== "object") return false;
  if (model.compat?.outputCapRequired === true) return true;

  const provider = lower(model.provider);
  const api = lower(model.api);
  const baseUrl = lower(model.baseUrl || model.base_url);

  return provider === "anthropic"
    || provider === "amazon-bedrock"
    || provider === "bedrock"
    || api === "anthropic-messages"
    || baseUrl.includes("api.anthropic.com");
}

function isImplicitSdkOutputCap(value, model) {
  const modelLimit = getModelOutputLimit(model);
  if (!modelLimit) return false;
  return positiveInteger(value) === Math.min(modelLimit, SDK_IMPLICIT_MAX_TOKENS_CAP);
}

function hasUserOutputCap(options = {}) {
  return options.outputBudgetSource === "user"
    || options.maxTokensSource === "user"
    || positiveInteger(options.userMaxTokens) !== null;
}

/**
 * Remove Pi SDK's hidden default output cap from providers where the field is
 * optional. This preserves provider-native defaults while keeping required
 * providers and official DeepSeek thinking handling intact.
 */
export function normalizeImplicitOutputBudget(payload, model, options = {}) {
  if (!payload || typeof payload !== "object") return payload;
  if (options.mode === "utility") return payload;
  if (hasUserOutputCap(options)) return payload;
  if (requiresOutputCap(model)) return payload;
  if (isOfficialDeepSeekEndpoint(model)) return payload;

  let next = payload;
  for (const field of OUTPUT_CAP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    if (!isImplicitSdkOutputCap(next[field], model)) continue;
    if (next === payload) next = { ...payload };
    delete next[field];
  }

  return next;
}
