import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureWritableGeneratedDir,
  findGeneratedFile,
  getDefaultGeneratedDir,
  recordOutputDirHistory,
  resolveGeneratedDir,
  validateOutputDir,
} from "../lib/generated-dir.js";

function createCtx(tempRoot, overrides = {}) {
  const store = { ...(overrides.initialConfig || {}) };
  return {
    dataDir: path.join(tempRoot, "plugin-data"),
    config: {
      get(key) {
        return key ? store[key] : { ...store };
      },
      set(key, value) {
        if (typeof value === "undefined") delete store[key];
        else store[key] = value;
      },
    },
    bus: {
      request: async () => ({ allowed: true }),
      ...(overrides.bus || {}),
    },
    log: { warn() {} },
  };
}

describe("generated-dir helpers", () => {
  let tempRoot = "";

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  });

  it("resolves the default generated directory when no outputDir is configured", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-generated-dir-"));
    const ctx = createCtx(tempRoot);
    expect(resolveGeneratedDir(ctx)).toBe(path.join(ctx.dataDir, "generated"));
    expect(getDefaultGeneratedDir(ctx)).toBe(path.join(ctx.dataDir, "generated"));
  });

  it("rejects output directories blocked by sandbox validation", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-generated-dir-"));
    const blockedDir = path.join(tempRoot, "blocked");
    const ctx = createCtx(tempRoot, {
      bus: {
        request: async () => ({ allowed: false, reason: "blocked by sandbox" }),
      },
    });

    const result = await validateOutputDir(ctx, blockedDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("blocked by sandbox");
  });

  it("falls back to the default directory when configured outputDir is blocked", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-generated-dir-"));
    const customDir = path.join(tempRoot, "custom");
    const ctx = createCtx(tempRoot, {
      initialConfig: { outputDir: customDir },
      bus: {
        request: async (_type, payload) => ({
          allowed: payload.path !== customDir,
          reason: "blocked by sandbox",
        }),
      },
    });

    const writable = await ensureWritableGeneratedDir(ctx);
    expect(writable).toBe(path.join(ctx.dataDir, "generated"));
    expect(fs.existsSync(writable)).toBe(true);
  });

  it("finds previously generated files after outputDir changes", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-generated-dir-"));
    const firstDir = path.join(tempRoot, "first");
    const secondDir = path.join(tempRoot, "second");
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(firstDir, "old.png"), "old");

    const ctx = createCtx(tempRoot, { initialConfig: { outputDir: secondDir } });
    recordOutputDirHistory(ctx, firstDir, secondDir);

    expect(findGeneratedFile(ctx, "old.png")).toBe(path.join(firstDir, "old.png"));
  });
});
