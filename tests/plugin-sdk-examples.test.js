import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const exampleDir = path.join(root, "examples", "plugins", "sdk-showcase");

describe("plugin SDK examples and docs", () => {
  it("documents the SDK package map in a top-level guide", () => {
    const guide = fs.readFileSync(path.join(root, "PLUGIN_SDK.md"), "utf-8");

    expect(guide).toContain("@hana/plugin-protocol");
    expect(guide).toContain("@hana/plugin-sdk");
    expect(guide).toContain("@hana/plugin-runtime");
    expect(guide).toContain("@hana/plugin-components");
    expect(guide).toContain("npm run build:packages");
  });

  it("ships a showcase plugin manifest that exercises iframe grants and UI contributions", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(exampleDir, "manifest.json"), "utf-8"));

    expect(manifest).toMatchObject({
      manifestVersion: 1,
      id: "sdk-showcase",
      trust: "full-access",
      ui: {
        hostCapabilities: ["external.open", "clipboard.writeText"],
      },
      contributes: {
        page: { route: "/page" },
        widget: { route: "/widget" },
      },
    });
  });

  it("covers runtime tools, EventBus, iframe SDK, and shared components in example source", () => {
    const index = fs.readFileSync(path.join(exampleDir, "index.js"), "utf-8");
    const tool = fs.readFileSync(path.join(exampleDir, "tools", "create-note.js"), "utf-8");
    const panel = fs.readFileSync(path.join(exampleDir, "ui", "Panel.tsx"), "utf-8");
    const readme = fs.readFileSync(path.join(exampleDir, "README.md"), "utf-8");

    expect(index).toContain("definePlugin");
    expect(index).toContain("defineBusHandler");
    expect(index).toContain("HANA_BUS_SKIP");
    expect(tool).toContain("defineTool");
    expect(tool).toContain("createMediaDetails");
    expect(panel).toContain("@hana/plugin-sdk");
    expect(panel).toContain("@hana/plugin-components");
    expect(panel).toContain("HanaThemeProvider");
    expect(readme).toContain("bundle the UI");
  });
});
