import { createHash, randomUUID } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import {
  createSkillSnapshotIdentity,
  createSkillSnapshotSourceSidecar,
  SKILL_SNAPSHOT_SOURCE_SIDECAR,
  sourceIdentityForSkill,
} from "./skill-file-identity.js";

const SNAPSHOT_DIR = ".skill-snapshots";
const MAX_SLUG_LENGTH = 48;

function jsonClone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function shortHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 10);
}

function sanitizePathPart(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return cleaned || fallback;
}

function isInsidePath(target, parent) {
  const rel = path.relative(parent, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertChildPath(child, parent, label) {
  if (!isInsidePath(child, parent)) {
    throw new Error(`${label} is outside skill baseDir: ${child}`);
  }
}

function snapshotStemForSession(sessionPath) {
  const basename = path.basename(sessionPath);
  const ext = path.extname(basename);
  const stem = ext ? basename.slice(0, -ext.length) : basename;
  return sanitizePathPart(stem, shortHash(basename));
}

function activeSessionDirForSnapshot(sessionPath) {
  const sessionDir = path.dirname(sessionPath);
  return path.basename(sessionDir) === "archived"
    ? path.dirname(sessionDir)
    : sessionDir;
}

function snapshotRootInDir(sessionDir, sessionPath) {
  const safeStem = snapshotStemForSession(sessionPath);
  return path.join(sessionDir, SNAPSHOT_DIR, safeStem);
}

function snapshotRootForSession(sessionPath) {
  return snapshotRootInDir(activeSessionDirForSnapshot(sessionPath), sessionPath);
}

function snapshotDirName(skill, index) {
  const ordinal = String(index + 1).padStart(3, "0");
  const slug = sanitizePathPart(skill?.name, "skill");
  const fingerprint = shortHash(skill?.filePath || skill?.baseDir || `${index}`);
  return `${ordinal}-${slug}-${fingerprint}`;
}

function rewriteSkillPaths(skill, filePath, baseDir, sourceIdentity, runtimeIdentity) {
  const sourceInfo = skill?.sourceInfo && typeof skill.sourceInfo === "object"
    ? { ...skill.sourceInfo, path: filePath, baseDir }
    : skill?.sourceInfo;
  return {
    ...skill,
    filePath,
    baseDir,
    sourceIdentity,
    runtimeIdentity,
    ...(sourceInfo ? { sourceInfo } : {}),
    _snapshotSourceFilePath: skill?.filePath || null,
    _snapshotSourceBaseDir: skill?.baseDir || null,
  };
}

async function copySkillDirectory(sourceBaseDir, targetBaseDir) {
  await fsp.cp(sourceBaseDir, targetBaseDir, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true,
  });
}

/**
 * Copy enabled skill directories into a stable per-session snapshot and rewrite
 * skill file paths to that snapshot. The snapshot belongs to the session, not
 * to the global SkillManager, so restoring an old session never consults the
 * mutable source skill directory for its skill body or relative assets.
 */
export async function snapshotSkillsForSession(skillsResult, sessionPath) {
  const normalized = {
    skills: Array.isArray(skillsResult?.skills) ? skillsResult.skills : [],
    diagnostics: Array.isArray(skillsResult?.diagnostics) ? skillsResult.diagnostics : [],
  };
  if (!sessionPath || normalized.skills.length === 0) {
    return jsonClone(normalized, { skills: [], diagnostics: [] });
  }

  const finalRoot = snapshotRootForSession(sessionPath);
  const tmpRoot = path.join(
    path.dirname(finalRoot),
    `.${path.basename(finalRoot)}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );

  await fsp.rm(tmpRoot, { recursive: true, force: true });
  await fsp.mkdir(tmpRoot, { recursive: true });

  try {
    const snapshotSkills = [];
    for (let index = 0; index < normalized.skills.length; index++) {
      const skill = normalized.skills[index];
      const sourceBaseDir = skill?.baseDir
        ? path.resolve(skill.baseDir)
        : (skill?.filePath ? path.dirname(path.resolve(skill.filePath)) : null);
      const sourceFilePath = skill?.filePath
        ? path.resolve(skill.filePath)
        : (sourceBaseDir ? path.join(sourceBaseDir, "SKILL.md") : null);

      if (!sourceBaseDir || !sourceFilePath) {
        throw new Error(`skill "${skill?.name || index}" has no filePath/baseDir to snapshot`);
      }
      assertChildPath(sourceFilePath, sourceBaseDir, `skill "${skill?.name || index}" filePath`);

      const stat = await fsp.stat(sourceFilePath);
      if (!stat.isFile()) {
        throw new Error(`skill "${skill?.name || index}" filePath is not a file: ${sourceFilePath}`);
      }

      const dirName = snapshotDirName(skill, index);
      const tmpBaseDir = path.join(tmpRoot, dirName);
      const finalBaseDir = path.join(finalRoot, dirName);
      if (isInsidePath(tmpBaseDir, sourceBaseDir) || isInsidePath(finalBaseDir, sourceBaseDir)) {
        throw new Error(`skill "${skill?.name || index}" snapshot target is inside source directory`);
      }

      await copySkillDirectory(sourceBaseDir, tmpBaseDir);
      const relativeSkillPath = path.relative(sourceBaseDir, sourceFilePath);
      const tmpSkillPath = path.join(tmpBaseDir, relativeSkillPath);
      const copiedStat = await fsp.stat(tmpSkillPath);
      if (!copiedStat.isFile()) {
        throw new Error(`skill "${skill?.name || index}" snapshot did not produce SKILL.md`);
      }

      const finalSkillPath = path.join(finalBaseDir, relativeSkillPath);
      const sourceIdentity = sourceIdentityForSkill(skill, {
        filePath: sourceFilePath,
        baseDir: sourceBaseDir,
      });
      const runtimeIdentity = createSkillSnapshotIdentity({
        filePath: finalSkillPath,
        baseDir: finalBaseDir,
      });
      await fsp.writeFile(
        path.join(tmpBaseDir, SKILL_SNAPSHOT_SOURCE_SIDECAR),
        JSON.stringify(createSkillSnapshotSourceSidecar({
          skillName: skill?.name || sourceIdentity.skillName,
          source: sourceIdentity,
          snapshot: runtimeIdentity,
        }), null, 2) + "\n",
        "utf-8",
      );

      snapshotSkills.push(rewriteSkillPaths(
        skill,
        finalSkillPath,
        finalBaseDir,
        sourceIdentity,
        runtimeIdentity,
      ));
    }

    await fsp.mkdir(path.dirname(finalRoot), { recursive: true });
    await fsp.rm(finalRoot, { recursive: true, force: true });
    await fsp.rename(tmpRoot, finalRoot);
    return {
      skills: jsonClone(snapshotSkills, []),
      diagnostics: jsonClone(normalized.diagnostics, []),
    };
  } catch (err) {
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw new Error(`session skill snapshot failed: ${err?.message || err}`);
  }
}

export function getSessionSkillSnapshotRoot(sessionPath) {
  return snapshotRootForSession(sessionPath);
}

export function deleteSessionSkillSnapshotSync(sessionPath) {
  if (!sessionPath) return;
  const activeRoot = snapshotRootForSession(sessionPath);
  const literalRoot = snapshotRootInDir(path.dirname(sessionPath), sessionPath);
  for (const root of new Set([activeRoot, literalRoot])) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
