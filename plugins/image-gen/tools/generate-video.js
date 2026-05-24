/**
 * plugins/image-gen/tools/generate-video.js
 *
 * Non-blocking video generation with task placeholders surfaced through the
 * shared mediaGeneration protocol.
 */
import { resolveImageProviderSelection } from "../lib/provider-resolution.js";

export const name = "generate-video";
export const description =
  "Generate videos from text or reference images. Submission is non-blocking and the result card updates automatically.";

export const parameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Video prompt" },
    image: { type: "string", description: "Optional reference image path" },
    duration: { type: "number", description: "Duration in seconds" },
    ratio: { type: "string", description: "Aspect ratio" },
    model: { type: "string", description: "Video model id" },
    provider: { type: "string", description: "Provider id override" },
  },
  required: ["prompt"],
};

function buildUnavailableResult(text) {
  return { content: [{ type: "text", text }] };
}

function createTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

function errorMessage(err) {
  return err?.message || String(err || "unknown error");
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
  ctx.log?.error?.(`[image-gen] video submit failed for ${taskId}:`, message);
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

async function resolveVideoAdapter(input, registry, resolved, submitCtx) {
  const explicitAdapter = typeof input.provider === "string" ? registry.get(input.provider) : null;
  if (explicitAdapter) return explicitAdapter;

  if (resolved?.adapterId) {
    const adapter = registry.get(resolved.adapterId);
    if (adapter && adapter.types?.includes("video") && await adapterIsAvailable(adapter, submitCtx)) {
      return adapter;
    }
  }

  const adapters = registry.getByType("video");
  for (let i = adapters.length - 1; i >= 0; i--) {
    const adapter = adapters[i];
    if (await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }
  return adapters.at(-1) || null;
}

async function runSubmitInBackground({ taskId, adapter, params, submitCtx, store, poller, ctx }) {
  try {
    const result = await adapter.submit(params, submitCtx);
    const hasProviderTaskId = typeof result?.taskId === "string" && result.taskId.trim();
    const adapterTaskId = hasProviderTaskId ? result.taskId : taskId;
    const files = Array.isArray(result?.files) ? result.files.filter(Boolean) : [];

    if (!hasProviderTaskId && files.length === 0) {
      throw new Error("Video generation provider returned neither taskId nor files");
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
    return buildUnavailableResult("Video generation plugin is not initialized.");
  }

  const sessionPath = normalizeSessionPath(ctx);
  if (!sessionPath) {
    return buildUnavailableResult("Video generation requires a concrete sessionPath for task ownership.");
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

  const adapter = await resolveVideoAdapter(input, registry, resolved, submitCtx);
  if (!adapter) {
    return buildUnavailableResult("No video generation provider is available.");
  }
  submitCtx.providerId ||= adapter.id;

  const taskId = createTaskId();
  const batchId = createTaskId();
  const modelId = resolved?.modelId || input.model;
  const params = {
    type: "video",
    prompt: input.prompt,
    ...(input.image && { image: input.image }),
    ...(input.duration && { duration: input.duration }),
    ...(input.ratio && { ratio: input.ratio }),
    ...(modelId && { model: modelId }),
    ...(resolved?.providerId && { providerId: resolved.providerId }),
  };

  const deliveryTarget = bridgeDeliveryTarget(ctx);
  const deferredMeta = {
    type: "video-generation",
    mediaKind: "video",
    deliveryIntent: "ui_only",
    triggerParentTurn: false,
    prompt: input.prompt,
    ...(deliveryTarget ? { deliveryTarget } : {}),
  };

  store.add({
    taskId,
    adapterId: adapter.id,
    batchId,
    type: "video",
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
  void runSubmitInBackground({
    taskId,
    adapter,
    params,
    submitCtx,
    store,
    poller,
    ctx,
  });

  return {
    content: [{
      type: "text",
      text: "Submitted a video generation task. Results will appear automatically below.",
    }],
    details: {
      mediaGeneration: {
        kind: "video",
        batchId,
        prompt: input.prompt,
        tasks: [{ taskId }],
      },
    },
  };
}
