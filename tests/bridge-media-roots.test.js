import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectBridgeMediaAllowedRoots } from "../lib/bridge/media-roots.js";

describe("Bridge media allowed roots", () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function makeDir(name) {
    if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bridge-roots-"));
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("includes the target agent workspace from getHomeCwd instead of deskManager.homePath", () => {
    const hanakoHome = makeDir("hana-home");
    const ownerHome = makeDir("owner-workspace");
    const otherHome = makeDir("other-workspace");
    const engine = {
      hanakoHome,
      getHomeCwd: vi.fn((agentId) => {
        if (agentId === "owner") return ownerHome;
        if (agentId === "other") return otherHome;
        return null;
      }),
      getAgents: vi.fn(() => new Map([
        ["owner", { id: "owner", deskManager: {} }],
        ["other", { id: "other", deskManager: {} }],
      ])),
    };

    const roots = collectBridgeMediaAllowedRoots(engine, { agentId: "owner" });

    expect(roots).toContain(fs.realpathSync(hanakoHome));
    expect(roots).toContain(fs.realpathSync(ownerHome));
    expect(roots).toContain(fs.realpathSync(otherHome));
    expect(engine.getHomeCwd).toHaveBeenCalledWith("owner");
    expect(engine.getHomeCwd).toHaveBeenCalledWith("other");
  });
});
