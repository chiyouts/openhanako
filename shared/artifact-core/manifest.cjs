"use strict";

/**
 * shared/artifact-core/manifest.cjs
 *
 * Schema-1 train manifest parse/validate/verify for the SWIFT artifact
 * pipeline (.docs/book/swift/work-items/c2-pipeline-design-v0.md §2, §4).
 *
 * Signatures are raw ed25519 over the exact manifest file bytes (Node
 * `crypto`, algorithm `null` — required for Ed25519 keys). Verification
 * always operates on the original bytes passed in, never a re-serialized
 * copy, so canonicalization drift can never silently break the trust
 * chain.
 */

const crypto = require("crypto");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`manifest: ${message}`);
}

function validateArtifactEntry(entry, label) {
  if (!isPlainObject(entry)) fail(`${label} must be an object`);
  if (typeof entry.version !== "string" || entry.version.length === 0) {
    fail(`${label}.version must be a non-empty string`);
  }
  if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
    fail(`${label}.sha256 must be a 64-character hex string`);
  }
  if (!Number.isInteger(entry.size) || entry.size < 0) {
    fail(`${label}.size must be a non-negative integer`);
  }
  if (typeof entry.path !== "string" || entry.path.length === 0) {
    fail(`${label}.path must be a non-empty string`);
  }
}

/**
 * Structural validation of a parsed manifest object against schema 1
 * (C2 §2). Throws a descriptive Error on the first violation found.
 * @param {unknown} value
 * @returns {object} the same value, narrowed, for chaining
 */
function validateManifest(value) {
  if (!isPlainObject(value)) fail("root must be an object");
  if (value.schema !== 1) fail(`unsupported schema ${JSON.stringify(value.schema)}`);
  if (!Number.isInteger(value.train) || value.train < 0) {
    fail("train must be a non-negative integer");
  }
  if (typeof value.channel !== "string" || value.channel.length === 0) {
    fail("channel must be a non-empty string");
  }
  if (typeof value.releasedAt !== "string" || Number.isNaN(Date.parse(value.releasedAt))) {
    fail("releasedAt must be an ISO date string");
  }
  if (typeof value.keyId !== "string" || value.keyId.length === 0) {
    fail("keyId must be a non-empty string");
  }
  if (typeof value.minShell !== "string" || value.minShell.length === 0) {
    fail("minShell must be a non-empty string");
  }
  if (
    !isPlainObject(value.contract) ||
    !Number.isInteger(value.contract.preload) ||
    !Number.isInteger(value.contract.serverProtocol)
  ) {
    fail("contract.{preload,serverProtocol} must be integers");
  }
  if (typeof value.urgent !== "boolean") fail("urgent must be a boolean");
  if (
    !isPlainObject(value.rollout) ||
    !Number.isFinite(value.rollout.percent) ||
    value.rollout.percent < 0 ||
    value.rollout.percent > 100 ||
    typeof value.rollout.salt !== "string"
  ) {
    fail("rollout.{percent,salt} invalid (percent must be 0-100, salt a string)");
  }
  if (!isPlainObject(value.artifacts)) fail("artifacts must be an object");
  validateArtifactEntry(value.artifacts.renderer, "artifacts.renderer");
  if (!isPlainObject(value.artifacts.server)) fail("artifacts.server must be an object");
  for (const [platformArch, entry] of Object.entries(value.artifacts.server)) {
    validateArtifactEntry(entry, `artifacts.server.${platformArch}`);
  }
  if (!Array.isArray(value.mirrors) || !value.mirrors.every((m) => typeof m === "string")) {
    fail("mirrors must be an array of strings");
  }
  return value;
}

/**
 * @param {Buffer|string} bytes - canonical manifest JSON bytes
 * @returns {object} validated manifest
 */
function parseManifest(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    fail(`invalid JSON (${err.message})`);
  }
  return validateManifest(value);
}

/**
 * Verifies a detached ed25519 signature over the exact manifest bytes,
 * against a pinned keyset. Requires manifest.keyId to be present in the
 * keyset (C2 §4 — verification requires the manifest's keyId to be
 * present AND the signature to check out).
 * @param {Buffer} manifestBytes - exact bytes that were signed
 * @param {Buffer} sigBytes - detached ed25519 signature
 * @param {Array<{keyId: string, publicKey: string|import('crypto').KeyObject}>} keyset
 * @returns {object} the validated manifest object
 */
function verifyManifest(manifestBytes, sigBytes, keyset) {
  if (!Buffer.isBuffer(manifestBytes)) fail("manifestBytes must be a Buffer");
  if (!Buffer.isBuffer(sigBytes)) fail("sigBytes must be a Buffer");
  const manifest = parseManifest(manifestBytes);

  const keyEntry = Array.isArray(keyset) ? keyset.find((k) => k.keyId === manifest.keyId) : undefined;
  if (!keyEntry) {
    fail(`keyId ${JSON.stringify(manifest.keyId)} not present in keyset`);
  }

  const publicKey =
    typeof keyEntry.publicKey === "string" ? crypto.createPublicKey(keyEntry.publicKey) : keyEntry.publicKey;

  let ok = false;
  try {
    ok = crypto.verify(null, manifestBytes, publicKey, sigBytes);
  } catch (err) {
    fail(`signature verification error for keyId ${manifest.keyId} (${err.message})`);
  }
  if (!ok) {
    fail(`signature verification failed for keyId ${manifest.keyId}`);
  }
  return manifest;
}

/**
 * Anti-rollback check (C2 §2): a manifest's train must be strictly
 * greater than the currently activated train. `currentTrain` of
 * `null`/`undefined` means "nothing activated yet" (seed case) and always
 * passes.
 * @param {{train: number}} manifest
 * @param {number|null|undefined} currentTrain
 */
function checkMonotonic(manifest, currentTrain) {
  if (currentTrain === null || currentTrain === undefined) return;
  if (!Number.isInteger(manifest.train)) fail("train must be an integer");
  if (!(manifest.train > currentTrain)) {
    fail(`train ${manifest.train} is not greater than current train ${currentTrain} (anti-rollback)`);
  }
}

module.exports = {
  parseManifest,
  validateManifest,
  verifyManifest,
  checkMonotonic,
};
