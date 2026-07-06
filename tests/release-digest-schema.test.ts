import { describe, expect, it } from "vitest";
import {
  DIGEST_ASSET_NAME,
  RELEASE_DIGEST_JSON_SCHEMA,
  validateReleaseDigest,
} from "../scripts/release-digest-schema.mjs";

function validDigest() {
  return {
    schemaVersion: 1,
    tag: "v0.425.4",
    version: "0.425.4",
    previousTag: "v0.425.3",
    generatedAt: "2026-07-05T00:00:00.000Z",
    noUserFacingChanges: false,
    summary: {
      zh: "更新流程更稳。",
      en: "The update flow is steadier.",
    },
    counts: { feature: 1, fix: 0, improvement: 1, migration: 0 },
    source: {
      owner: "liliMozi",
      repo: "openhanako",
      commitRange: "v0.425.3..v0.425.4",
      releaseUrl: "https://github.com/liliMozi/openhanako/releases/tag/v0.425.4",
      releaseNotes: "",
    },
    items: [
      {
        id: "update-digest",
        kind: "feature",
        importance: "high",
        title: { zh: "更新摘要", en: "Update digest" },
        summary: { zh: "About 页展示更新内容。", en: "The About page shows update details." },
        details: [],
        sources: [{ type: "commit", ref: "abc123", title: "Add update digest" }],
      },
    ],
  };
}

describe("release digest schema", () => {
  it("keeps the public asset name stable", () => {
    expect(DIGEST_ASSET_NAME).toBe("release-digest.v1.json");
    expect(RELEASE_DIGEST_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("accepts a bilingual digest with cited items", () => {
    expect(validateReleaseDigest(validDigest())).toEqual({ ok: true, errors: [] });
  });

  it("rejects empty user-facing digests unless explicitly marked as non-user-facing", () => {
    const digest = validDigest();
    digest.items = [];
    const result = validateReleaseDigest(digest);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("must not be empty");
  });
});
