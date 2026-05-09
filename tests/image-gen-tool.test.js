import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("generate-image tool metadata", () => {
  it("exports name and required params", () => {
    expect(name).toBe("generate-image");
    expect(description).toBeTruthy();
    expect(parameters.required).toContain("prompt");
  });
});

describe("generate-image tool initialization guard", () => {
  it("returns an initialization error when media plugin state is missing", async () => {
    const result = await execute({ prompt: "a cat" }, makeCtx(null));
    expect(result.content[0].text).toContain("not initialized");
  });
});

describe("generate-image tool adapter resolution", () => {
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
    const poller = { add: vi.fn() };
    const getWritableGeneratedDir = vi.fn(async () => "/tmp/generated");
    const ctx = makeCtx({ registry, store, poller, getWritableGeneratedDir });

    const result = await execute({ prompt: "a desk lamp" }, ctx);

    expect(openaiAdapter.submit).toHaveBeenCalledOnce();
    expect(codexAdapter.submit).not.toHaveBeenCalled();
    expect(result.details.card.type).toBe("iframe");
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

describe("generate-image tool submission flow", () => {
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

  it("returns an iframe card on success", async () => {
    const result = await execute({ prompt: "a sunset" }, makeCtx(makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-abc" })),
    })));

    expect(result.content[0].text).toContain("Submitted 1 image generation task");
    expect(result.details.card.type).toBe("iframe");
    expect(result.details.card.route).toMatch(/^\/card\?batch=/);
    expect(result.details.card.title).toBe("Image Generation");
  });

  it("records tasks, deferred registration and poller activity", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-deferred" })),
    });
    const busRequest = vi.fn(async () => ({}));
    const ctx = makeCtx(mediaGen, { request: busRequest });

    await execute({ prompt: "ocean" }, ctx);

    expect(mediaGen.store.add).toHaveBeenCalledOnce();
    expect(mediaGen.poller.add).toHaveBeenCalledWith("t-deferred");
    expect(busRequest.mock.calls.find(([type]) => type === "deferred:register")).toBeTruthy();
  });

  it("stores returned file names immediately when submit is synchronous", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-files", files: ["img.png"] })),
    });

    await execute({ prompt: "a bird" }, makeCtx(mediaGen));

    expect(mediaGen.store.update).toHaveBeenCalledWith("t-files", { files: ["img.png"] });
  });

  it("handles parallel submissions and clamps count to 1-9", async () => {
    let seq = 0;
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: `t-${++seq}` })),
    });

    const result = await execute({ prompt: "stars", count: 10 }, makeCtx(mediaGen));

    expect(mediaGen.store.add).toHaveBeenCalledTimes(9);
    expect(result.content[0].text).toContain("Submitted 9 image generation task");
  });

  it("keeps successful tasks when some submissions fail", async () => {
    let seq = 0;
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => {
        seq += 1;
        if (seq === 2) throw new Error("network error");
        return { taskId: `t-${seq}` };
      }),
    });

    const result = await execute({ prompt: "rain", count: 3 }, makeCtx(mediaGen));

    expect(result.content[0].text).toContain("Submitted 2 image generation task");
    expect(result.content[0].text).toContain("1 submission(s) failed");
    expect(result.details.card).toBeTruthy();
  });

  it("returns a submission error when everything fails", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => { throw new Error("quota exceeded"); }),
    });

    const result = await execute({ prompt: "snow", count: 2 }, makeCtx(mediaGen));

    expect(result.content[0].text).toContain("Image submission failed");
    expect(result.content[0].text).toContain("quota exceeded");
    expect(result.details).toBeUndefined();
  });

  it("passes image-to-image references through unchanged", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-img2img" })),
    });

    await execute({ prompt: "enhance", image: "/path/to/ref.png" }, makeCtx(mediaGen));

    const [submittedParams] = mediaGen.adapter.submit.mock.calls[0];
    expect(submittedParams.image).toBe("/path/to/ref.png");
  });

  it("treats deferred registration failures as non-fatal", async () => {
    const mediaGen = makeMediaGen({
      submit: vi.fn(async () => ({ taskId: "t-deferred-fail" })),
    });
    const ctx = makeCtx(mediaGen, {
      request: vi.fn(async (type) => {
        if (type === "deferred:register") throw new Error("bus unavailable");
        return {};
      }),
    });

    const result = await execute({ prompt: "fire" }, ctx);

    expect(result.details.card).toBeTruthy();
    expect(ctx.log.warn).toHaveBeenCalled();
  });
});
