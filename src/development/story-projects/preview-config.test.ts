// @vitest-environment node
import { describe, expect, it } from "vitest";
import previewConfig from "../../../vite.story-projects.config";
import { readFileSync } from "node:fs";

describe("development preview entry configuration", () => {
  it("refuses a production build", () => {
    expect(() => previewConfig({ command: "build", mode: "story-projects" })).toThrow("development-only");
  });
  it("refuses the legacy/default development mode", () => {
    expect(() => previewConfig({ command: "serve", mode: "development" })).toThrow("development-only");
  });
  it("isolates environment loading, plugins and the server binding", () => {
    const config = previewConfig({ command: "serve", mode: "story-projects" });
    expect(config.envDir?.replace(/\\/g, "/")).toMatch(/\/development\/story-projects$/);
    expect(config.envPrefix).toEqual(["VITE_STORY_PROJECTS_", "VITE_API_"]);
    expect(config.server).toMatchObject({ host: "127.0.0.1", port: 5173, strictPort: true, open: "/story-projects.html" });
    expect(config.appType).toBe("mpa");
    expect(config.plugins?.flat().map(plugin => plugin && "name" in plugin ? plugin.name : "").join(" ")).not.toMatch(/mcp|lovable/i);
  });
  it("prevents auth callback credentials leaking in outgoing referrers", () => {
    const html = readFileSync(new URL("../../../story-projects.html", import.meta.url), "utf8");
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf('<script'));
  });
});
