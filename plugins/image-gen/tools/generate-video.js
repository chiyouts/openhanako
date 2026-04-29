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

export async function execute(input, ctx) {
  const { registry, store, poller, getWritableGeneratedDir } = ctx._mediaGen || {};
  if (!registry || !store || !poller || typeof getWritableGeneratedDir !== "function") {
    return buildUnavailableResult("Video generation plugin is not initialized.");
  }

  const adapter = input.provider
    ? registry.get(input.provider)
    : registry.getByType("video").at(-1) || null;
  if (!adapter) {
    return buildUnavailableResult("No video generation provider is available.");
  }

  const generatedDir = await getWritableGeneratedDir({ agentId: ctx.agentId });
  const submitCtx = {
    dataDir: ctx.dataDir,
    bus: ctx.bus,
    log: ctx.log,
    generatedDir,
    config: ctx.config,
  };

  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const params = {
    type: "video",
    prompt: input.prompt,
    ...(input.image && { image: input.image }),
    ...(input.duration && { duration: input.duration }),
    ...(input.ratio && { ratio: input.ratio }),
    ...(input.model && { model: input.model }),
  };

  let result;
  try {
    result = await adapter.submit(params, submitCtx);
  } catch (err) {
    return buildUnavailableResult(`Video submission failed: ${err?.message || "unknown error"}`);
  }

  if (!result?.taskId) {
    return buildUnavailableResult("Video submission failed: missing task id.");
  }

  store.add({
    taskId: result.taskId,
    adapterId: adapter.id,
    batchId,
    type: "video",
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
      meta: { type: "video-generation", prompt: input.prompt },
    });
  } catch (err) {
    ctx.log.warn(`deferred:register failed for ${result.taskId}:`, err);
  }

  try {
    await ctx.bus.request("task:register", {
      taskId: result.taskId,
      type: "media-generation",
      parentSessionPath: ctx.sessionPath,
      meta: { type: "video-generation", prompt: input.prompt },
    });
  } catch {
    // best effort
  }

  poller.add(result.taskId);

  return {
    content: [{ type: "text", text: "Submitted a video generation task. The result card will update automatically." }],
    details: {
      card: {
        type: "iframe",
        route: `/card?batch=${batchId}`,
        title: "Video Generation",
        description: input.prompt.slice(0, 60),
        aspectRatio: input.ratio || "16:9",
      },
    },
  };
}
