const OPENAI_API_FAMILIES = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

export function isOpenAIImageProvider(entry) {
  return OPENAI_API_FAMILIES.has(entry?.api || "");
}

export function isVolcengineImageProvider(entry) {
  const providerId = entry?.id || "";
  return providerId === "volcengine" || providerId === "volcengine-coding";
}

export async function resolveImageProviderSelection(input, ctx) {
  const explicitProvider = typeof input.provider === "string" ? input.provider.trim() : "";
  const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
  const defaultModel = ctx.config?.get?.("defaultImageModel");

  let providerId = explicitProvider;
  let modelId = requestedModel;

  if (!providerId && modelId) {
    const result = await ctx.bus?.request?.("provider:models-by-type", { type: "image" }).catch(() => ({ models: [] }));
    const matches = (result?.models || []).filter((item) => item.id === modelId);
    if (matches.length === 1) {
      providerId = matches[0].provider;
    }
  }

  if (!modelId && defaultModel?.id) {
    modelId = defaultModel.id;
  }

  if (!providerId && defaultModel?.provider && (!modelId || modelId === defaultModel.id)) {
    providerId = defaultModel.provider;
  }

  if (!providerId) return null;

  const entryResult = await ctx.bus?.request?.("provider:entry", { providerId }).catch(() => null);
  const entry = entryResult?.entry || null;
  if (!entry) return null;

  if (isVolcengineImageProvider(entry)) {
    return { providerId, adapterId: "volcengine", modelId };
  }

  if (isOpenAIImageProvider(entry)) {
    return { providerId, adapterId: "openai", modelId };
  }

  return null;
}
