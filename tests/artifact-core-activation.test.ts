import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import ustarModule from "../shared/artifact-core/ustar.cjs";
import pointerStoreModule from "../shared/artifact-core/pointer-store.cjs";
import activationModule from "../shared/artifact-core/activation.cjs";

const { packTree } = ustarModule as {
  packTree: (srcDir: string, archivePath: string) => Promise<void>;
};
const { writePointer, readPointer, appendQuarantine } = pointerStoreModule as {
  writePointer: (homeDir: string, channel: string, slot: string, value: any) => Promise<void>;
  readPointer: (homeDir: string, channel: string, slot: string) => Promise<any>;
  appendQuarantine: (homeDir: string, entry: any) => Promise<any[]>;
};
const {
  activateFromArchive,
  resolveBoot,
  writeSentinel,
  clearSentinel,
  consecutiveFailures,
  sha256File,
} = activationModule as {
  activateFromArchive: (archivePath: string, manifest: any, opts: any) => Promise<any>;
  resolveBoot: (channel: string, homeDir: string) => Promise<{ slot: string; pointer: any } | null>;
  writeSentinel: (homeDir: string, channel: string, train: number) => Promise<any>;
  clearSentinel: (homeDir: string, channel: string) => Promise<void>;
  consecutiveFailures: (homeDir: string, channel: string) => Promise<number>;
  sha256File: (filePath: string) => Promise<string>;
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function makeServerArchiveFixture(root: string) {
  const srcDir = path.join(root, "server-src");
  await fsp.mkdir(srcDir, { recursive: true });
  await fsp.writeFile(path.join(srcDir, "hana-server.js"), "console.log('hi');\n");
  const archivePath = path.join(root, "server-1.0.0-darwin-arm64.tar.gz");
  await packTree(srcDir, archivePath);
  return archivePath;
}

function manifestFor(sha256: string, train = 1) {
  // Server artifact version is tied to `train` so distinct activations land
  // in distinct versionDirs (`<version>-<platformArch>`) — collapsing them
  // to the same directory would make one activation's `.verified` receipt
  // clobber another's, which is exactly the kind of bug resolveBoot's
  // fallback chain exists to be tested against.
  const serverVersion = `1.0.${train}`;
  return {
    schema: 1,
    train,
    channel: "stable",
    releasedAt: "2026-08-01T12:00:00Z",
    keyId: "2026a",
    minShell: "1.0.0",
    contract: { preload: 1, serverProtocol: 1 },
    urgent: false,
    rollout: { percent: 100, salt: "x" },
    artifacts: {
      renderer: {
        version: "1.0.0",
        sha256: "c".repeat(64),
        size: 1,
        path: "renderer-1.0.0.tar.gz",
      },
      server: {
        "darwin-arm64": {
          version: serverVersion,
          sha256,
          size: 1,
          path: `server-${serverVersion}-darwin-arm64.tar.gz`,
        },
      },
    },
    mirrors: [],
  };
}

describe("activation: activateFromArchive", () => {
  it("verifies sha256, extracts, writes .verified receipt and the next pointer", async () => {
    const root = makeTempDir("hana-activation-");
    const homeDir = path.join(root, "home");
    const archivePath = await makeServerArchiveFixture(root);
    const sha256 = await sha256File(archivePath);
    const manifest = manifestFor(sha256, 7);

    const pointerValue = await activateFromArchive(archivePath, manifest, {
      homeDir,
      channel: "stable",
      kind: "server",
      platformArch: "darwin-arm64",
    });

    expect(pointerValue.train).toBe(7);
    expect(pointerValue.sha256).toBe(sha256);
    expect(fs.existsSync(path.join(pointerValue.versionDir, "hana-server.js"))).toBe(true);
    expect(fs.existsSync(path.join(pointerValue.versionDir, ".verified"))).toBe(true);

    const nextPointer = await readPointer(homeDir, "stable", "next");
    expect(nextPointer).toEqual(pointerValue);
  });

  it("rejects a sha256 mismatch and does not write a next pointer", async () => {
    const root = makeTempDir("hana-activation-badsha-");
    const homeDir = path.join(root, "home");
    const archivePath = await makeServerArchiveFixture(root);
    const manifest = manifestFor("f".repeat(64), 8); // wrong sha256

    await expect(
      activateFromArchive(archivePath, manifest, {
        homeDir,
        channel: "stable",
        kind: "server",
        platformArch: "darwin-arm64",
      }),
    ).rejects.toThrow(/sha256 mismatch/i);

    expect(await readPointer(homeDir, "stable", "next")).toBeNull();
  });

  it("short-circuits on a quarantined train: no extraction, no pointer write", async () => {
    const root = makeTempDir("hana-activation-quarantine-");
    const homeDir = path.join(root, "home");
    const archivePath = await makeServerArchiveFixture(root);
    const sha256 = await sha256File(archivePath);
    const manifest = manifestFor(sha256, 9);

    await appendQuarantine(homeDir, { channel: "stable", train: 9, reason: "test" });

    await expect(
      activateFromArchive(archivePath, manifest, {
        homeDir,
        channel: "stable",
        kind: "server",
        platformArch: "darwin-arm64",
      }),
    ).rejects.toThrow(/quarantined/i);

    expect(await readPointer(homeDir, "stable", "next")).toBeNull();
    const serverRoot = path.join(homeDir, "artifacts", "server");
    expect(fs.existsSync(serverRoot)).toBe(false);
  });
});

describe("activation: resolveBoot three-level fallback", () => {
  async function activateVersion(root: string, homeDir: string, train: number) {
    const archivePath = await makeServerArchiveFixture(path.join(root, `v${train}`));
    const sha256 = await sha256File(archivePath);
    const manifest = manifestFor(sha256, train);
    return activateFromArchive(archivePath, manifest, {
      homeDir,
      channel: "stable",
      kind: "server",
      platformArch: "darwin-arm64",
    });
  }

  it("resolves via current when current is valid", async () => {
    const root = makeTempDir("hana-boot-current-");
    const homeDir = path.join(root, "home");
    const pointerValue = await activateVersion(root, homeDir, 1);
    await writePointer(homeDir, "stable", "current", pointerValue);

    const result = await resolveBoot("stable", homeDir);
    expect(result?.slot).toBe("current");
    expect(result?.pointer.train).toBe(1);
  });

  it("falls back to previous when current is missing its .verified receipt", async () => {
    const root = makeTempDir("hana-boot-fallback-");
    const homeDir = path.join(root, "home");

    const previousPointer = await activateVersion(root, homeDir, 1);
    await writePointer(homeDir, "stable", "previous", previousPointer);

    const currentPointer = await activateVersion(root, homeDir, 2);
    await writePointer(homeDir, "stable", "current", currentPointer);
    // Corrupt current's activation: delete its .verified receipt.
    await fsp.unlink(path.join(currentPointer.versionDir, ".verified"));

    const result = await resolveBoot("stable", homeDir);
    expect(result?.slot).toBe("previous");
    expect(result?.pointer.train).toBe(1);
  });

  it("falls back to previous when current's versionDir sha256 no longer matches the receipt", async () => {
    const root = makeTempDir("hana-boot-shamismatch-");
    const homeDir = path.join(root, "home");

    const previousPointer = await activateVersion(root, homeDir, 1);
    await writePointer(homeDir, "stable", "previous", previousPointer);

    const currentPointer = await activateVersion(root, homeDir, 2);
    await writePointer(homeDir, "stable", "current", currentPointer);
    // Tamper with the pointer's recorded sha256 so it no longer matches the receipt on disk.
    await writePointer(homeDir, "stable", "current", { ...currentPointer, sha256: "tampered" });

    const result = await resolveBoot("stable", homeDir);
    expect(result?.slot).toBe("previous");
  });

  it("returns null when neither current nor previous is bootable (caller falls to seed)", async () => {
    const root = makeTempDir("hana-boot-null-");
    const homeDir = path.join(root, "home");
    const result = await resolveBoot("stable", homeDir);
    expect(result).toBeNull();
  });

  it("returns null when both current and previous are invalid", async () => {
    const root = makeTempDir("hana-boot-both-invalid-");
    const homeDir = path.join(root, "home");

    const pointerValue = await activateVersion(root, homeDir, 1);
    await writePointer(homeDir, "stable", "current", { ...pointerValue, sha256: "tampered" });
    await writePointer(homeDir, "stable", "previous", { ...pointerValue, sha256: "also-tampered" });

    const result = await resolveBoot("stable", homeDir);
    expect(result).toBeNull();
  });
});

describe("activation: crash sentinel helpers", () => {
  it("counts consecutive writes for the same train", async () => {
    const homeDir = makeTempDir("hana-sentinel-");
    expect(await consecutiveFailures(homeDir, "stable")).toBe(0);

    await writeSentinel(homeDir, "stable", 5);
    expect(await consecutiveFailures(homeDir, "stable")).toBe(1);

    await writeSentinel(homeDir, "stable", 5);
    await writeSentinel(homeDir, "stable", 5);
    expect(await consecutiveFailures(homeDir, "stable")).toBe(3);
  });

  it("resets the counter when the train changes", async () => {
    const homeDir = makeTempDir("hana-sentinel-reset-");
    await writeSentinel(homeDir, "stable", 5);
    await writeSentinel(homeDir, "stable", 5);
    expect(await consecutiveFailures(homeDir, "stable")).toBe(2);

    await writeSentinel(homeDir, "stable", 6); // new train, healthy boot after an update
    expect(await consecutiveFailures(homeDir, "stable")).toBe(1);
  });

  it("clearSentinel resets the counter to 0", async () => {
    const homeDir = makeTempDir("hana-sentinel-clear-");
    await writeSentinel(homeDir, "stable", 5);
    await clearSentinel(homeDir, "stable");
    expect(await consecutiveFailures(homeDir, "stable")).toBe(0);
  });

  it("sentinels for different channels are independent", async () => {
    const homeDir = makeTempDir("hana-sentinel-channels-");
    await writeSentinel(homeDir, "stable", 5);
    await writeSentinel(homeDir, "beta", 9);
    expect(await consecutiveFailures(homeDir, "stable")).toBe(1);
    expect(await consecutiveFailures(homeDir, "beta")).toBe(1);
    await clearSentinel(homeDir, "beta");
    expect(await consecutiveFailures(homeDir, "stable")).toBe(1);
    expect(await consecutiveFailures(homeDir, "beta")).toBe(0);
  });
});
