/**
 * plugins/image-gen/tools/generate-image.js
 *
 * Non-blocking image generation. Registers local placeholder tasks first,
 * then submits to the provider in the background. Completion is surfaced
 * through Poller + DeferredResultStore.
 */
import { resolveImageProviderSelection } from "../lib/provider-resolution.js";

export const name = "generate-image";
export const description =
  "Generate images from text or reference images. Submission is non-blocking and the result card updates automatically.";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Image prompt" },
    count: { type: "number", description: "How many images to submit in parallel, 1-9" },
    image: { type: "string", description: "Optional reference image path for image-to-image generation" },
    ratio: { type: "string", description: "Aspect ratio, for example 1:1 or 16:9" },
    resolution: { type: "string", description: "Resolution tier, for example 2k or 4k" },
    model: { type: "string", description: "Image model id" },
    provider: { type: "string", description: "Provider id override" },
  },
  required: ["prompt"],
};

function buildUnavailableResult(text) {
  return { content: [{ type: "text", text }] };
}

async function adapterIsAvailable(adapter, submitCtx) {
  if (typeof adapter?.checkAuth !== "function") return true;
  try {
    const result = await adapter.checkAuth(submitCtx);
    return result?.ok !== false;
  } catch {
    return false;
  }
}

function createTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function errorMessage(err) {
  return err?.message || String(err || "unknown error");
}

function normalizeSessionPath(ctx) {
  const sessionPath = typeof ctx?.sessionPath === "string" ? ctx.sessionPath.trim() : "";
  return sessionPath || null;
}

function bridgeDeliveryTarget(ctx) {
  const bridge = ctx?.bridgeContext;
  if (bridge?.isBridgeSession !== true || !bridge.platform || !bridge.chatId) return null;
  return {
    kind: "bridge",
    platform: bridge.platform,
    chatId: bridge.chatId,
    ...(bridge.sessionKey ? { sessionKey: bridge.sessionKey } : {}),
    ...(bridge.agentId ? { agentId: bridge.agentId } : {}),
    ...(bridge.chatType ? { chatType: bridge.chatType } : {}),
  };
}

export async function resolveImageAdapter(input, registry, resolved, submitCtx) {
  const explicitAdapter = typeof input.provider === "string" ? registry.get(input.provider) : null;
  if (explicitAdapter) return explicitAdapter;

  if (resolved?.adapterId) {
    const adapter = registry.get(resolved.adapterId);
    if (adapter && await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }

  const defaultProvider = submitCtx.config?.get?.("defaultImageModel")?.provider;
  if (defaultProvider) {
    const adapter = registry.get(defaultProvider);
    if (adapter && await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }

  const adapters = registry.getByType("image");
  for (let i = adapters.length - 1; i >= 0; i--) {
    const adapter = adapters[i];
    if (await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }
  return adapters.at(-1) || null;
}

function markSubmitFailed({ taskId, err, store, ctx }) {
  const message = errorMessage(err);
  store.update(taskId, {
    status: "failed",
    failReason: message,
    submitState: "failed",
    completedAt: new Date().toISOString(),
  });
  ctx.bus.request("deferred:fail", { taskId, error: err }).catch(() => {});
  ctx.bus.request("task:remove", { taskId }).catch(() => {});
  ctx.log?.error?.(`[image-gen] submit failed for ${taskId}:`, message);
}

async function runSubmitInBackground({ taskId, adapter, params, submitCtx, store, poller, ctx }) {
  try {
    const result = await adapter.submit(params, submitCtx);
    const hasProviderTaskId = typeof result?.taskId === "string" && result.taskId.trim();
    const adapterTaskId = hasProviderTaskId ? result.taskId : taskId;
    const files = Array.isArray(result?.files) ? result.files.filter(Boolean) : [];

    if (!hasProviderTaskId && files.length === 0) {
      throw new Error("Image generation provider returned neither taskId nor files");
    }

    store.update(taskId, {
      submitState: "submitted",
      adapterTaskId,
      ...(files.length ? { files } : {}),
    });

    if (files.length && typeof poller.checkNow === "function") {
      void poller.checkNow(taskId);
    }
  } catch (err) {
    markSubmitFailed({ taskId, err, store, ctx });
  }
}

export async function execute(input, ctx) {
  const { registry, store, poller, getWritableGeneratedDir } = ctx._mediaGen || {};
  if (!registry || !store || !poller || typeof getWritableGeneratedDir !== "function") {
    return buildUnavailableResult("Image generation plugin is not initialized.");
  }

  const sessionPath = normalizeSessionPath(ctx);
  if (!sessionPath) {
    return buildUnavailableResult("Image generation requires a concrete sessionPath for task ownership.");
  }

  const generatedDir = await getWritableGeneratedDir({ agentId: ctx.agentId });
  const resolved = await resolveImageProviderSelection(input, ctx);
  const submitCtx = {
    dataDir: ctx.dataDir,
    bus: ctx.bus,
    log: ctx.log,
    generatedDir,
    config: ctx.config,
    providerId: resolved?.providerId || input.provider,
  };

  const adapter = await resolveImageAdapter(input, registry, resolved, submitCtx);
  if (!adapter) {
    return buildUnavailableResult("No image generation provider is available.");
  }
  submitCtx.providerId ||= adapter.id;

  const count = Math.min(Math.max(input.count || 1, 1), 9);
  const batchId = createTaskId();
  const modelId = resolved?.modelId || input.model;

  const params = {
    type: "image",
    prompt: input.prompt,
    ...(input.ratio && { ratio: input.ratio }),
    ...(input.resolution && { resolution: input.resolution }),
    ...(modelId && { model: modelId }),
    ...(input.image && { image: input.image }),
    ...(resolved?.providerId && { providerId: resolved.providerId }),
  };

  const submitted = [];
  const deliveryTarget = bridgeDeliveryTarget(ctx);
  const deferredMeta = {
    type: "image-generation",
    mediaKind: "image",
    deliveryIntent: "ui_only",
    triggerParentTurn: false,
    prompt: input.prompt,
    ...(deliveryTarget ? { deliveryTarget } : {}),
  };

  for (let i = 0; i < count; i++) {
    const taskId = createTaskId();
    store.add({
      taskId,
      adapterId: adapter.id,
      batchId,
      type: "image",
      prompt: input.prompt,
      params,
      sessionPath,
      ...(deliveryTarget ? { deliveryTarget } : {}),
      submitState: "submitting",
      adapterTaskId: null,
      generatedDir,
    });

    try {
      await ctx.bus.request("deferred:register", {
        taskId,
        sessionPath,
        meta: deferredMeta,
      });
    } catch (err) {
      ctx.log.warn(`deferred:register failed for ${taskId}:`, err);
    }

    try {
      await ctx.bus.request("task:register", {
        taskId,
        type: "media-generation",
        parentSessionPath: sessionPath,
        meta: deferredMeta,
      });
    } catch {
      // best effort
    }

    poller.add(taskId);
    submitted.push({ taskId });

    void runSubmitInBackground({
      taskId,
      adapter,
      params,
      submitCtx,
      store,
      poller,
      ctx,
    });
  }

  return {
    content: [{
      type: "text",
      text: `Submitted ${submitted.length} image generation task(s). Results will appear automatically below.`,
    }],
    details: {
      mediaGeneration: {
        kind: "image",
        batchId,
        prompt: input.prompt,
        tasks: submitted,
      },
    },
  };
}
