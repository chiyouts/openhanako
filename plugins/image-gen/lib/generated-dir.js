import fs from "fs";
import os from "os";
import path from "path";

const HISTORY_LIMIT = 20;

function expandHome(rawPath) {
  if (typeof rawPath !== "string") return "";
  if (!rawPath.startsWith("~")) return rawPath;
  return path.join(os.homedir(), rawPath.slice(1));
}

function uniqPaths(paths) {
  const seen = new Set();
  const result = [];
  for (const value of paths) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeCandidate(rawPath, dataDir) {
  const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!trimmed) return "";
  const expanded = expandHome(trimmed);
  return path.normalize(
    path.isAbsolute(expanded)
      ? expanded
      : path.resolve(dataDir, expanded),
  );
}

function readOutputDirHistory(ctx) {
  const raw = ctx.config?.get?.("outputDirHistory");
  if (!Array.isArray(raw)) return [];
  return uniqPaths(
    raw
      .map((item) => normalizeCandidate(item, ctx.dataDir))
      .filter(Boolean),
  );
}

export function getDefaultGeneratedDir(ctx) {
  return path.join(ctx.dataDir, "generated");
}

export function resolveGeneratedDir(ctx) {
  const configured = normalizeCandidate(ctx.config?.get?.("outputDir"), ctx.dataDir);
  return configured || getDefaultGeneratedDir(ctx);
}

export function recordOutputDirHistory(ctx, previousDir, nextDir = resolveGeneratedDir(ctx)) {
  const normalizedPrev = normalizeCandidate(previousDir, ctx.dataDir);
  const normalizedNext = normalizeCandidate(nextDir, ctx.dataDir);
  if (!normalizedPrev || normalizedPrev === normalizedNext) return;

  const nextHistory = uniqPaths([
    normalizedPrev,
    ...readOutputDirHistory(ctx).filter((item) => item !== normalizedNext),
  ]).slice(0, HISTORY_LIMIT);

  ctx.config?.set?.("outputDirHistory", nextHistory);
}

export async function validateOutputDir(ctx, rawDir, { agentId } = {}) {
  const outputDir = normalizeCandidate(rawDir, ctx.dataDir) || getDefaultGeneratedDir(ctx);
  const request = ctx.bus?.request;
  const sandboxResult = typeof request === "function"
    ? await request("sandbox:check-path", {
      path: outputDir,
      operation: "write",
      agentId,
    }).catch(() => ({ allowed: true }))
    : { allowed: true };

  if (sandboxResult && sandboxResult.allowed === false) {
    return {
      ok: false,
      outputDir,
      error: sandboxResult.reason || "path not allowed by sandbox",
    };
  }

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const stat = fs.statSync(outputDir);
    if (!stat.isDirectory()) {
      return { ok: false, outputDir, error: "output path is not a directory" };
    }
  } catch (err) {
    return {
      ok: false,
      outputDir,
      error: err?.message || String(err),
    };
  }

  return { ok: true, outputDir };
}

export async function ensureWritableGeneratedDir(ctx, { agentId } = {}) {
  const configuredDir = resolveGeneratedDir(ctx);
  const validation = await validateOutputDir(ctx, configuredDir, { agentId });
  if (validation.ok) return validation.outputDir;

  const fallbackDir = getDefaultGeneratedDir(ctx);
  if (configuredDir !== fallbackDir) {
    ctx.log?.warn?.(
      `[image-gen] configured outputDir is unavailable, falling back to default: ${validation.error}`,
    );
    const fallbackValidation = await validateOutputDir(ctx, fallbackDir, { agentId });
    if (fallbackValidation.ok) return fallbackValidation.outputDir;
  }

  throw new Error(validation.error || "unable to prepare generated output directory");
}

export function getGeneratedFileCandidates(ctx, filename) {
  if (!filename) return [];
  const currentDir = resolveGeneratedDir(ctx);
  const historyDirs = readOutputDirHistory(ctx);
  return uniqPaths([
    path.join(currentDir, filename),
    ...historyDirs.map((dir) => path.join(dir, filename)),
    path.join(getDefaultGeneratedDir(ctx), filename),
  ]);
}

export function findGeneratedFile(ctx, filename) {
  for (const filePath of getGeneratedFileCandidates(ctx, filename)) {
    try {
      if (fs.statSync(filePath).isFile()) return filePath;
    } catch {
      // keep probing historical locations
    }
  }
  return null;
}

export function removeGeneratedFiles(ctx, files) {
  for (const filename of files || []) {
    for (const filePath of getGeneratedFileCandidates(ctx, filename)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best effort cleanup
      }
    }
  }
}
