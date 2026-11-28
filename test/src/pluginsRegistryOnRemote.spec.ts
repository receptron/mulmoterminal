// #3506. How each View draws on a remote cell's Canvas. The whole list, so giving another View a
// rule is a visible edit here. A View drawn as is with no runtime around it reaches nothing on this
// server; one with a runtime dispatches to the cell's host (pluginRuntime.ts).
import { describe, it, expect } from "vitest";
import { plugin as formPlugin } from "@mulmoclaude/form-plugin/vue";
import { plugin as brepPlugin } from "@gui-chat-plugin/brep/vue";
import { plugin as jingleScriptPlugin } from "@gui-chat-plugin/jinglescript/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import { plugin as markdownPlugin } from "@mulmoclaude/markdown-plugin/vue";
import { plugin as chartPlugin } from "@mulmoclaude/chart-plugin/vue";
import { plugin as htmlPlugin } from "@mulmoclaude/html-plugin/vue";
import { plugin as spreadsheetPlugin } from "@gui-chat-plugin/spreadsheet/vue";
import { plugin as shapeScriptPlugin } from "@gui-chat-plugin/shapescript/vue";
import { plugin as mulmoScriptPlugin } from "@mulmoclaude/mulmoscript-plugin/vue";
import { plugin as collectionPlugin } from "@mulmoclaude/collection-plugin/vue";
import { getPlugin } from "../../src/plugins-registry";
import { drawnAsIs, htmlPageOnHost, inlineChartsOnly } from "../../src/components/remoteCanvasCards";

const SELF_CONTAINED = [formPlugin, brepPlugin, jingleScriptPlugin, GenerateImagePlugin.plugin];

describe("the Views a remote cell's Canvas draws", () => {
  it.each(SELF_CONTAINED.map((p) => [p.toolDefinition.name, p] as const))("draws %s as is, its package's own View", (name, p) => {
    expect(getPlugin(name)?.onRemote).toBe(drawnAsIs);
    expect(getPlugin(name)?.viewComponent).toBe(p.viewComponent);
  });
  it.each([
    [markdownPlugin.toolDefinition.name, drawnAsIs],
    [htmlPlugin.toolDefinition.name, htmlPageOnHost],
    [chartPlugin.toolDefinition.name, inlineChartsOnly],
    [shapeScriptPlugin.toolDefinition.name, drawnAsIs],
    [spreadsheetPlugin.toolDefinition.name, drawnAsIs],
    [mulmoScriptPlugin.toolDefinition.name, drawnAsIs],
    [collectionPlugin.toolDefinition.name, drawnAsIs],
    ["manageAccounting", drawnAsIs],
  ])("draws %s by its own rule", (name, rule) => {
    expect(getPlugin(name)?.onRemote).toBe(rule);
  });
});
