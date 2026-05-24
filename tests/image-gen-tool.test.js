import { describe, it, expect, vi, beforeEach } from "vitest";

let execute;
let name;
let description;
let parameters;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../plugins/image-gen/tools/generate-image.js");
  execute = mod.execute;
  name = mod.name;
  description = mod.description;
  parameters = mod.parameters;
});

function makeAdapter(overrides = {}) {
  return {
    id: "fake-provider",
    types: ["image"],
    checkAuth: vi.fn(async () => ({ ok: true })),
    submit: vi.fn(async () => ({ taskId: "task-001" })),
    ...overrides,
  };
}

function makeMediaGen(adapterOverrides = {}) {
  const adapter = makeAdapter(adapterOverrides);
  const registry = {
    get: vi.fn((id) => (id === adapter.id ? adapter : undefined)),
    getByType: vi.fn(() => [adapter]),
  };
  const store = {
    add: vi.fn(),
    update: vi.fn(),
  };
  const poller = {
    add: vi.fn(),
    checkNow: vi.fn(),
  };
  const getWritableGeneratedDir = vi.fn(async () => "/tmp/generated");
  return { registry, store, poller, adapter, getWritableGeneratedDir };
}

function makeCtx(mediaGen, busOverrides = {}) {
  return {
    _mediaGen: mediaGen,
    dataDir: "/tmp/test-data",
    sessionPath: "/sessions/test.jsonl",
    agentId: "agent-1",
    config: {
      get: vi.fn((key) => {
        if (key === "defaultImageModel") return undefined;
        return {};
      }),
    },
    bus: {
      request: vi.fn(async () => ({})),
      ...busOverrides,
    },
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

async function flushBackgroundSubmits() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("generate-image tool — metadata", () => {
  it("exports correct name and required param", () => {
    expect(name).toBe("generate-image");
    expect(description).toBeTruthy();
    expect(parameters.required).toContain("prompt");
  });
});

describe("generate-image tool — initialization guard", () => {
  it("returns an initialization error when media plugin state is missing", async () => {
    const result = await execute({ prompt: "a cat" }, makeCtx(null));
    expect(result.content[0].text).toContain("not initialized");
  });

  it("requires an explicit sessionPath before starting a background task", async () => {
    const mediaGen = makeMediaGen();
    const ctx = { ...makeCtx(mediaGen), sessionPath: null };

    const result = await execute({ prompt: "a cat" }, ctx);

    expect(result.content[0].text).toContain("sessionPath");
    expect(mediaGen.store.add).not.toHaveBeenCalled();
  });
});

describe("generate-image tool — adapter resolution", () => {
  it("returns an error when no adapter is available", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen();
    registry.getByType.mockReturnValue([]);
    const result = await execute({ prompt: "a cat" }, makeCtx({ registry, store, poller, getWritableGeneratedDir }));
    expect(result.content[0].text).toContain("No image generation provider");
  });

  it("uses an explicit adapter id directly when present in the registry", async () => {
    const { registry, store, poller, adapter, getWritableGeneratedDir } = makeMediaGen();
    registry.get.mockImplementation((id) => (id === "fake-provider" ? adapter : undefined));
    await execute({ prompt: "a cat", provider: "fake-provider" }, makeCtx({ registry, store, poller, getWritableGeneratedDir }));
    expect(registry.get).toHaveBeenCalledWith("fake-provider");
  });

  it("uses last registered adapter when no provider is specified", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen();
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "a cat" }, ctx);
    expect(registry.getByType).toHaveBeenCalledWith("image");
  });

  it("falls back to the newest credentialed image adapter when a later adapter is unavailable", async () => {
    const openaiAdapter = makeAdapter({
      id: "openai",
      submit: vi.fn(async () => ({ taskId: "task-openai", files: ["img.png"] })),
    });
    const codexAdapter = makeAdapter({
      id: "openai-codex-oauth",
      checkAuth: vi.fn(async () => ({ ok: false, message: "no_credentials" })),
      submit: vi.fn(async () => {
        throw new Error("not logged in");
      }),
    });
    const registry = {
      get: vi.fn(),
      getByType: vi.fn(() => [openaiAdapter, codexAdapter]),
    };
    const store = { add: vi.fn(), update: vi.fn() };
    const poller = { add: vi.fn(), checkNow: vi.fn() };
    const getWritableGeneratedDir = vi.fn(async () => "/tmp/generated");
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "a desk lamp" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;

    expect(openaiAdapter.submit).toHaveBeenCalledOnce();
    expect(codexAdapter.submit).not.toHaveBeenCalled();
    expect(result.details.mediaGeneration.tasks).toEqual([{ taskId }]);
  });

  it("maps a custom OpenAI-compatible provider to the OpenAI adapter", async () => {
    const mediaGen = makeMediaGen({
      id: "openai",
      submit: vi.fn(async () => ({ taskId: "custom-1" })),
    });
    mediaGen.registry.get.mockImplementation((id) => (id === "openai" ? mediaGen.adapter : undefined));

    const busRequest = vi.fn(async (type, payload) => {
      if (type === "provider:entry" && payload.providerId === "custom-openai") {
        return { entry: { id: "custom-openai", api: "openai-completions" } };
      }
      return {};
    });

    const ctx = makeCtx(mediaGen, { request: busRequest });
    await execute({ prompt: "a cat", provider: "custom-openai" }, ctx);

    expect(mediaGen.registry.get).toHaveBeenCalledWith("openai");
    expect(mediaGen.adapter.submit).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "custom-openai" }),
      expect.objectContaining({ providerId: "custom-openai" }),
    );
  });

  it("infers provider from the configured default image model", async () => {
    const mediaGen = makeMediaGen({
      id: "openai",
      submit: vi.fn(async () => ({ taskId: "default-1" })),
    });
    mediaGen.registry.get.mockImplementation((id) => (id === "openai" ? mediaGen.adapter : undefined));

    const ctx = makeCtx(mediaGen, {
      request: vi.fn(async (type, payload) => {
        if (type === "provider:entry" && payload.providerId === "custom-openai") {
          return { entry: { id: "custom-openai", api: "openai-completions" } };
        }
        return {};
      }),
    });
    ctx.config.get = vi.fn((key) => {
      if (key === "defaultImageModel") return { id: "gpt-image-2", provider: "custom-openai" };
      return {};
    });

    await execute({ prompt: "a cat" }, ctx);

    expect(mediaGen.adapter.submit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-image-2", providerId: "custom-openai" }),
      expect.objectContaining({ providerId: "custom-openai" }),
    );
  });
});

describe("generate-image tool — submit error", () => {
  it("returns a placeholder and marks the task failed when background submit throws", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => { throw new Error("CLI not found"); }),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "a cat" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;
    expect(result.content[0].text).toContain("Submitted 1 image generation task");

    await flushBackgroundSubmits();

    expect(store.update).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({
        status: "failed",
        failReason: "CLI not found",
        submitState: "failed",
      }),
    );
  });
});

describe("generate-image tool — successful submission flow", () => {
  it("passes the resolved generated directory into the adapter and task store", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-store" })),
    });
    const ctx = makeCtx(mediaGen);

    await execute({ prompt: "mountains" }, ctx);

    expect(mediaGen.getWritableGeneratedDir).toHaveBeenCalledWith({ agentId: "agent-1" });
    expect(mediaGen.adapter.submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "mountains" }),
      expect.objectContaining({ generatedDir: "/tmp/generated" }),
    );
    expect(mediaGen.store.add).toHaveBeenCalledWith(
      expect.objectContaining({ generatedDir: "/tmp/generated" }),
    );
  });

  it("returns mediaGeneration metadata on successful single submit", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-abc" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "a sunset" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;

    expect(result.content[0].text).toContain("Submitted 1 image generation task");
    expect(result.details.card).toBeUndefined();
    expect(result.details.mediaGeneration).toMatchObject({
      kind: "image",
      prompt: "a sunset",
      tasks: [{ taskId }],
    });
    expect(result.details.mediaGeneration.batchId).toBeTruthy();
  });

  it("records task with submitState=submitting", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-store" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "mountains" }, ctx);

    expect(store.add).toHaveBeenCalledOnce();
    const call = store.add.mock.calls[0][0];
    expect(call.taskId).toBeTruthy();
    expect(call.type).toBe("image");
    expect(call.prompt).toBe("mountains");
    expect(call.adapterTaskId).toBeNull();
    expect(call.submitState).toBe("submitting");
  });

  it("registers task with deferred:register", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-deferred" })),
    });
    const busRequest = vi.fn(async () => ({}));
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir }, { request: busRequest });

    await execute({ prompt: "ocean" }, ctx);

    const deferredCall = busRequest.mock.calls.find(([type]) => type === "deferred:register");
    const taskId = store.add.mock.calls[0][0].taskId;
    expect(deferredCall).toBeTruthy();
    expect(deferredCall[1].taskId).toBe(taskId);
    expect(deferredCall[1].meta.type).toBe("image-generation");
    expect(deferredCall[1].meta.mediaKind).toBe("image");
    expect(deferredCall[1].meta.deliveryIntent).toBe("ui_only");
    expect(deferredCall[1].meta.triggerParentTurn).toBe(false);
  });

  it("marks bridge-originated tasks for bridge delivery", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-bridge-deferred" })),
    });
    const busRequest = vi.fn(async () => ({}));
    const ctx = {
      ...makeCtx({ registry, store, poller, getWritableGeneratedDir }, { request: busRequest }),
      bridgeContext: {
        isBridgeSession: true,
        platform: "wechat",
        chatId: "wx-user",
        sessionKey: "wx_dm_wx-user@hanako",
        agentId: "hanako",
        chatType: "dm",
      },
    };

    await execute({ prompt: "ocean" }, ctx);

    const deferredCall = busRequest.mock.calls.find(([type]) => type === "deferred:register");
    expect(deferredCall[1].meta.deliveryTarget).toEqual({
      kind: "bridge",
      platform: "wechat",
      chatId: "wx-user",
      sessionKey: "wx_dm_wx-user@hanako",
      agentId: "hanako",
      chatType: "dm",
    });
  });

  it("adds task to poller", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-poll" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "forest" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;

    expect(poller.add).toHaveBeenCalledWith(taskId);
  });

  it("updates the local task when background submit returns files", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-files", files: ["img.png"] })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "a bird" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;
    await flushBackgroundSubmits();

    expect(store.update).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({
        adapterTaskId: "t-files",
        files: ["img.png"],
        submitState: "submitted",
      }),
    );
  });
});

describe("generate-image tool — multi submit behavior", () => {
  it("submits count times and records all tasks", async () => {
    let callIndex = 0;
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: `t-${++callIndex}` })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "stars", count: 3 }, ctx);

    expect(store.add).toHaveBeenCalledTimes(3);
    expect(poller.add).toHaveBeenCalledTimes(3);
    expect(result.content[0].text).toContain("Submitted 3 image generation task");
  });

  it("clamps count to max 9", async () => {
    let callIndex = 0;
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: `t-${++callIndex}` })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "clouds", count: 10 }, ctx);

    expect(store.add).toHaveBeenCalledTimes(9);
  });

  it("clamps count to min 1", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-min" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "waves", count: 0 }, ctx);

    expect(store.add).toHaveBeenCalledTimes(1);
  });
});

describe("generate-image tool — partial failure handling", () => {
  it("returns placeholders for all requested images and records per-task background failures", async () => {
    let callIndex = 0;
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => {
        callIndex++;
        if (callIndex === 2) throw new Error("network error");
        return { taskId: `t-${callIndex}` };
      }),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "rain", count: 3 }, ctx);
    expect(result.content[0].text).toContain("Submitted 3 image generation task");
    expect(result.details.mediaGeneration.tasks).toHaveLength(3);

    await flushBackgroundSubmits();

    const failedUpdates = store.update.mock.calls.filter(([, patch]) => patch.status === "failed");
    expect(failedUpdates).toHaveLength(1);
    expect(failedUpdates[0][1].failReason).toBe("network error");
  });

  it("returns placeholders even when every background submit later fails", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => { throw new Error("quota exceeded"); }),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "snow", count: 2 }, ctx);
    expect(result.content[0].text).toContain("Submitted 2 image generation task");
    expect(result.details.mediaGeneration.tasks).toHaveLength(2);

    await flushBackgroundSubmits();

    const failedUpdates = store.update.mock.calls.filter(([, patch]) => patch.status === "failed");
    expect(failedUpdates).toHaveLength(2);
    expect(failedUpdates[0][1].failReason).toBe("quota exceeded");
  });

  it("marks a background submit with no provider taskId or files as failed", async () => {
    let callIndex = 0;
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => {
        callIndex++;
        return callIndex === 2 ? {} : { taskId: `t-${callIndex}` };
      }),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "ice", count: 2 }, ctx);
    expect(result.content[0].text).toContain("Submitted 2 image generation task");

    await flushBackgroundSubmits();

    const failedUpdates = store.update.mock.calls.filter(([, patch]) => patch.status === "failed");
    expect(failedUpdates).toHaveLength(1);
    expect(failedUpdates[0][1].failReason).toContain("neither taskId nor files");
  });
});

describe("generate-image tool — image param", () => {
  it("passes image param to adapter.submit", async () => {
    const { registry, store, poller, adapter, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-img2img" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "enhance", image: "/path/to/ref.png" }, ctx);

    const [submittedParams] = adapter.submit.mock.calls[0];
    expect(submittedParams.image).toBe("/path/to/ref.png");
  });

  it("omits image key from params when not provided", async () => {
    const { registry, store, poller, adapter, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-no-img" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    await execute({ prompt: "landscape" }, ctx);

    const [submittedParams] = adapter.submit.mock.calls[0];
    expect(submittedParams).not.toHaveProperty("image");
  });
});

describe("generate-image tool — deferred registration failures are non-fatal", () => {
  it("still returns media placeholder metadata when deferred:register throws", async () => {
    const { registry, store, poller, getWritableGeneratedDir } = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-deferred-fail" })),
    });
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir }, {
      request: vi.fn(async (type) => {
        if (type === "deferred:register") throw new Error("bus unavailable");
        return {};
      }),
    });

    const result = await execute({ prompt: "fire" }, ctx);
    const taskId = store.add.mock.calls[0][0].taskId;

    expect(result.content[0].text).toContain("Submitted 1 image generation task");
    expect(result.details.mediaGeneration.tasks).toEqual([{ taskId }]);
    expect(ctx.log.warn).toHaveBeenCalled();
  });
});
