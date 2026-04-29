import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveSandboxPolicy } from "../lib/sandbox/policy.js";
import { AccessLevel, PathGuard } from "../lib/sandbox/path-guard.js";

describe("sandbox workspace roots", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-sandbox-roots-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("grants full access to explicit extra workspace folders but not siblings", () => {
    const agentDir = path.join(tempRoot, "agents", "hana");
    const hanakoHome = path.join(tempRoot, "home");
    const primary = path.join(tempRoot, "project");
    const extra = path.join(tempRoot, "reference");
    const sibling = path.join(tempRoot, "private");
    for (const dir of [agentDir, hanakoHome, primary, extra, sibling]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const policy = deriveSandboxPolicy({
      agentDir,
      hanakoHome,
      workspace: primary,
      workspaceFolders: [extra],
      mode: "standard",
    });
    const guard = new PathGuard(policy);

    expect(policy.writablePaths).toContain(primary);
    expect(policy.writablePaths).toContain(extra);
    expect(policy.protectedPaths).toContain(path.join(primary, ".git"));
    expect(policy.protectedPaths).toContain(path.join(extra, ".git"));
    expect(guard.getAccessLevel(path.join(extra, "note.md"))).toBe(AccessLevel.FULL);
    expect(guard.check(path.join(sibling, "secret.md"), "read").allowed).toBe(false);
  });

  it("grants read-only access to extra plugin skill roots outside the workspace", () => {
    const agentDir = path.join(tempRoot, "agents", "hana");
    const hanakoHome = path.join(tempRoot, "home");
    const workspace = path.join(tempRoot, "project");
    const pluginSkills = path.join(tempRoot, "plugins", "image-gen", "skills");
    const skillFile = path.join(pluginSkills, "image-gen-guide", "SKILL.md");

    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(hanakoHome, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(skillFile, "# skill");

    const policy = deriveSandboxPolicy({
      agentDir,
      hanakoHome,
      workspace,
      mode: "standard",
      extraReadOnlyPaths: [pluginSkills],
    });
    const guard = new PathGuard(policy);

    expect(guard.getAccessLevel(skillFile)).toBe(AccessLevel.READ_ONLY);
    expect(guard.check(skillFile, "read").allowed).toBe(true);
    expect(guard.check(skillFile, "write").allowed).toBe(false);
  });
});
