import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

const { runAgentSessionMock } = vi.hoisted(() => ({
  runAgentSessionMock: vi.fn(async () => "OK"),
}));

vi.mock("../hub/agent-executor.js", () => ({
  runAgentSession: runAgentSessionMock,
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ChannelRouter } from "../hub/channel-router.js";

describe("ChannelRouter reply tool boundary", () => {
  it("runs hidden channel reply sessions with the read-only tool set", async () => {
    runAgentSessionMock.mockClear();

    const engine = { marker: "engine" };
    const router = new ChannelRouter({
      hub: {
        engine,
        eventBus: { emit: vi.fn() },
      },
    });

    const result = await router._executeReply(
      "hanako",
      "ch_crew",
      "user: @Hanako please reply OK",
    );

    expect(result).toBe("OK");
    expect(runAgentSessionMock).toHaveBeenCalledOnce();
    expect(runAgentSessionMock.mock.calls[0][2]).toMatchObject({
      engine,
      sessionSuffix: "channel-temp",
      readOnly: true,
    });
  });

  it("emits a complete incremental message after writing a channel reply", async () => {
    runAgentSessionMock.mockClear();
    runAgentSessionMock.mockResolvedValueOnce("OK");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-router-"));
    const channelsDir = path.join(root, "channels");
    const agentsDir = path.join(root, "agents");
    const userDir = path.join(root, "user");
    const productDir = path.join(root, "product");
    fs.mkdirSync(path.join(agentsDir, "hanako"), { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "hanako", "config.yaml"), "agent:\n  name: Hanako\n", "utf-8");
    fs.writeFileSync(path.join(channelsDir, "ch_crew.md"), "---\nid: ch_crew\nmembers: [hanako]\n---\n", "utf-8");

    const emit = vi.fn();
    const router = new ChannelRouter({
      hub: {
        engine: {
          channelsDir,
          agentsDir,
          userDir,
          productDir,
          isChannelsEnabled: () => true,
        },
        eventBus: { emit },
      },
    });

    const result = await router._executeCheck(
      "hanako",
      "ch_crew",
      [{ sender: "user", timestamp: "2026-05-07 17:00:00", body: "@Hanako ping" }],
      [],
    );

    expect(result.replied).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "channel_new_message",
      channelName: "ch_crew",
      sender: "hanako",
      message: expect.objectContaining({
        sender: "hanako",
        body: "OK",
      }),
    }), null);
    expect(emit.mock.calls[0][0].message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
