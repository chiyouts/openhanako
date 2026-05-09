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

export async function resolveImageAdapter(input, registry, resolved, submitCtx) {
  const explicitAdapter = typeof input.provider === "string" ? registry.get(input.provider) : null;
  if (explicitAdapter) return explicitAdapter;

  if (resolved?.adapterId) {
    const adapter = registry.get(resolved.adapterId);
    if (adapter && await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }

  const adapters = registry.getByType("image");
  for (let i = adapters.length - 1; i >= 0; i--) {
    const adapter = adapters[i];
    if (await adapterIsAvailable(adapter, submitCtx)) return adapter;
  }
  return adapters.at(-1) || null;
}

export async function execute(input, ctx) {
  const { registry, store, poller, getWritableGeneratedDir } = ctx._mediaGen || {};
  if (!registry || !store || !poller || typeof getWritableGeneratedDir !== "function") {
    return buildUnavailableResult("Image generation plugin is not initialized.");
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
  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const params = {
    type: "image",
    prompt: input.prompt,
    ...(input.ratio && { ratio: input.ratio }),
    ...(input.resolution && { resolution: input.resolution }),
    ...((resolved?.modelId || input.model) && { model: resolved?.modelId || input.model }),
    ...(input.image && { image: input.image }),
    ...(resolved?.providerId && { providerId: resolved.providerId }),
  };

  const results = await Promise.all(
    Array.from({ length: count }, () =>
      adapter.submit(params, submitCtx).catch((err) => ({ _error: err })),
    ),
  );

  const succeeded = [];
  let failCount = 0;

  for (const result of results) {
    if (result._error || !result.taskId) {
      failCount += 1;
      continue;
    }

    succeeded.push(result);

    store.add({
      taskId: result.taskId,
      adapterId: adapter.id,
      batchId,
      type: "image",
      prompt: input.prompt,
      params,
      sessionPath: ctx.sessionPath,
      generatedDir,
    });

    if (result.files?.length) {
      store.update(result.taskId, { files: result.files });
    }

    try {
      await ctx.bus.request("deferred:register", {
        taskId: result.taskId,
        sessionPath: ctx.sessionPath,
        meta: { type: "image-generation", prompt: input.prompt },
      });
    } catch (err) {
      ctx.log.warn(`deferred:register failed for ${result.taskId}:`, err);
    }

    try {
      await ctx.bus.request("task:register", {
        taskId: result.taskId,
        type: "media-generation",
        parentSessionPath: ctx.sessionPath,
        meta: { type: "image-generation", prompt: input.prompt },
      });
    } catch {
      // best effort
    }

    poller.add(result.taskId);
  }

  if (succeeded.length === 0) {
    const firstErr = results.find((item) => item._error)?._error;
    return buildUnavailableResult(`Image submission failed: ${firstErr?.message || "unknown error"}`);
  }

  let text = `Submitted ${succeeded.length} image generation task(s). The result card will update automatically.`;
  if (failCount > 0) {
    text += ` ${failCount} submission(s) failed.`;
  }

  return {
    content: [{ type: "text", text }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "Image Generation",
        description: `${input.prompt.slice(0, 60)} (${succeeded.length})`,
        aspectRatio: input.ratio || "1:1",
      },
    },
  };
}
