#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const REQUIRED_ARCHES = ["arm64", "x64"];
const METADATA_NAME_RE = /^latest-mac(?:-[A-Za-z0-9_-]+)?\.yml$/;

function fail(message) {
  throw new Error(message);
}

function walkFiles(dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

function pathMentionsArch(filePath, arch) {
  const parts = filePath.split(path.sep).map((part) => part.toLowerCase());
  const needle = arch.toLowerCase();
  return parts.some((part) => part.includes(needle));
}

function candidateRank(filePath, arch) {
  const base = path.basename(filePath).toLowerCase();
  if (base === `latest-mac-${arch}.yml`) return 0;
  if (base === "latest-mac.yml") return 1;
  return 2;
}

function findMetadataFile(artifactsDir, arch) {
  const candidates = walkFiles(artifactsDir)
    .filter((filePath) => METADATA_NAME_RE.test(path.basename(filePath)))
    .filter((filePath) => pathMentionsArch(filePath, arch))
    .sort((a, b) => {
      const rankDiff = candidateRank(a, arch) - candidateRank(b, arch);
      return rankDiff || a.localeCompare(b);
    });

  if (candidates.length === 0) {
    fail(`Missing macOS update metadata for ${arch}`);
  }
  return candidates[0];
}

function readUpdateInfo(filePath) {
  const parsed = yaml.load(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`Invalid update metadata in ${filePath}: expected a YAML object`);
  }
  if (!Array.isArray(parsed.files)) {
    fail(`Invalid update metadata in ${filePath}: missing files array`);
  }
  return parsed;
}

function findRequiredFile(info, arch, ext) {
  const suffix = `macOS-${arch}.${ext}`;
  const match = info.files.find((file) => typeof file?.url === "string" && file.url.endsWith(suffix));
  if (!match) {
    fail(`Missing ${suffix} entry in ${info.sourcePath}`);
  }
  if (!match.sha512) {
    fail(`Missing sha512 for ${suffix} in ${info.sourcePath}`);
  }
  return match;
}

function validateUpdateInfo(info, arch) {
  if (!info.version) {
    fail(`Missing version in ${info.sourcePath}`);
  }
  findRequiredFile(info, arch, "zip");
  findRequiredFile(info, arch, "dmg");
}

function mergeLatestMac(artifactsDir) {
  const infos = new Map();
  for (const arch of REQUIRED_ARCHES) {
    const sourcePath = findMetadataFile(artifactsDir, arch);
    const info = readUpdateInfo(sourcePath);
    info.sourcePath = sourcePath;
    validateUpdateInfo(info, arch);
    infos.set(arch, info);
  }

  const versions = new Set([...infos.values()].map((info) => String(info.version)));
  if (versions.size !== 1) {
    fail(`Mismatched macOS update metadata versions: ${[...versions].join(", ")}`);
  }

  const mergedFiles = [];
  const seenUrls = new Set();
  for (const arch of REQUIRED_ARCHES) {
    for (const file of infos.get(arch).files) {
      if (!file?.url || seenUrls.has(file.url)) continue;
      seenUrls.add(file.url);
      mergedFiles.push(file);
    }
  }

  const arm64 = infos.get("arm64");
  const arm64Zip = findRequiredFile(arm64, "arm64", "zip");
  const merged = {
    version: arm64.version,
    files: mergedFiles,
    path: arm64Zip.url,
    sha512: arm64Zip.sha512,
  };
  if (arm64.releaseDate) merged.releaseDate = arm64.releaseDate;

  for (const arch of REQUIRED_ARCHES) {
    findRequiredFile({ ...merged, sourcePath: "merged latest-mac.yml" }, arch, "zip");
    findRequiredFile({ ...merged, sourcePath: "merged latest-mac.yml" }, arch, "dmg");
  }

  return merged;
}

function main(argv) {
  const [, , artifactsDir, outputPath] = argv;
  if (!artifactsDir || !outputPath) {
    fail("Usage: node scripts/merge-latest-mac-yml.cjs <artifacts-dir> <output-path>");
  }
  if (!fs.existsSync(artifactsDir) || !fs.statSync(artifactsDir).isDirectory()) {
    fail(`Artifacts directory does not exist: ${artifactsDir}`);
  }

  const merged = mergeLatestMac(artifactsDir);
  fs.writeFileSync(outputPath, yaml.dump(merged, { lineWidth: -1 }), "utf8");
  console.log(`Merged latest-mac.yml with ${merged.files.length} files`);
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (err) {
    console.error(`::error::${err.message || String(err)}`);
    process.exit(1);
  }
}

module.exports = { mergeLatestMac };
