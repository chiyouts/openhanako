import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotSkillsForSession } from "../lib/skills/session-skill-snapshot.js";

describe("session skill snapshot identity", () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function makeTempRoot() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-skill-snapshot-"));
    return tmpDir;
  }

  it("keeps runtime snapshot paths separate from editable source identity", async () => {
    const root = makeTempRoot();
    const sessionPath = path.join(root, "agents", "hana", "sessions", "main.jsonl");
    const sourceBaseDir = path.join(root, "workspace", ".agents", "skills", "demo-skill");
    const sourceFilePath = path.join(sourceBaseDir, "SKILL.md");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(sourceBaseDir, { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n", "utf-8");
    fs.writeFileSync(sourceFilePath, "---\nname: demo-skill\n---\n# Demo\n", "utf-8");

    const result = await snapshotSkillsForSession({
      skills: [{
        name: "demo-skill",
        description: "Demo skill.",
        filePath: sourceFilePath,
        baseDir: sourceBaseDir,
        source: "external",
        _workspaceSkill: true,
      }],
      diagnostics: [],
    }, sessionPath);

    const snapshotSkill = result.skills[0];
    expect(snapshotSkill.filePath).not.toBe(sourceFilePath);
    expect(snapshotSkill.runtimeIdentity).toMatchObject({
      kind: "skill_snapshot",
      filePath: snapshotSkill.filePath,
      baseDir: snapshotSkill.baseDir,
      readonly: true,
    });
    expect(snapshotSkill.sourceIdentity).toEqual({
      kind: "skill_source",
      owner: "workspace",
      skillName: "demo-skill",
      filePath: sourceFilePath,
      baseDir: sourceBaseDir,
      editable: true,
      readonly: false,
    });

    const sidecarPath = path.join(snapshotSkill.baseDir, ".hana-skill-source.json");
    expect(JSON.parse(fs.readFileSync(sidecarPath, "utf-8"))).toEqual({
      version: 1,
      kind: "skill_snapshot_source",
      skillName: "demo-skill",
      source: snapshotSkill.sourceIdentity,
      snapshot: snapshotSkill.runtimeIdentity,
    });
  });
});
