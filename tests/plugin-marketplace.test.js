import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { PluginMarketplace } from "../lib/plugin-marketplace.js";

describe("PluginMarketplace", () => {
  it("loads local marketplace entries and resolves source/readme paths", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-marketplace-"));
    try {
      fs.mkdirSync(path.join(dir, "plugins", "demo"), { recursive: true });
      fs.writeFileSync(path.join(dir, "plugins", "demo", "manifest.json"), "{}", "utf8");
      fs.writeFileSync(path.join(dir, "README-demo.md"), "# Demo\n\nHello", "utf8");
      const indexPath = path.join(dir, "marketplace.json");
      fs.writeFileSync(indexPath, JSON.stringify({
        schemaVersion: 1,
        plugins: [{
          schemaVersion: 1,
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "1.0.0",
          description: "Demo plugin",
          repository: "https://example.com/demo",
          compatibility: { minAppVersion: "0.170.0" },
          trust: "restricted",
          permissions: ["task.read"],
          contributions: ["tools"],
          distribution: { kind: "source", path: "plugins/demo" },
          readmePath: "README-demo.md",
        }],
      }), "utf8");

      const marketplace = new PluginMarketplace({ indexPath });
      const data = await marketplace.load();
      const plugin = data.plugins[0];

      expect(plugin).toMatchObject({
        id: "demo",
        name: "Demo",
        distribution: {
          kind: "source",
          path: "plugins/demo",
          resolvedPath: path.join(dir, "plugins", "demo"),
        },
      });
      expect(marketplace.resolveSourceDistribution(plugin)).toBe(path.join(dir, "plugins", "demo"));
      await expect(marketplace.getReadme("demo")).resolves.toContain("# Demo");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty marketplace when no source is configured", async () => {
    const marketplace = new PluginMarketplace();
    await expect(marketplace.load()).resolves.toMatchObject({
      source: { kind: "none", configured: false },
      plugins: [],
    });
  });
});
