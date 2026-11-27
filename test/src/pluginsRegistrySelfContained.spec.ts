// #3506. A remote cell's Canvas draws only a card whose View draws from the result alone; every other
// View reads files, plugin routes or a runtime on this machine. The whole list, so marking another
// View is a visible edit here — and each marked one is the package's own View, with no runtime
// provider around it, which is what reaching nothing on this server rests on.
import { describe, it, expect } from "vitest";
import { plugin as formPlugin } from "@mulmoclaude/form-plugin/vue";
import { plugin as brepPlugin } from "@gui-chat-plugin/brep/vue";
import { plugin as jingleScriptPlugin } from "@gui-chat-plugin/jinglescript/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import { plugin as markdownPlugin } from "@mulmoclaude/markdown-plugin/vue";
import { plugin as chartPlugin } from "@mulmoclaude/chart-plugin/vue";
import { plugin as htmlPlugin } from "@mulmoclaude/html-plugin/vue";
import { plugin as spreadsheetPlugin } from "@gui-chat-plugin/spreadsheet/vue";
import { plugin as collectionPlugin } from "@mulmoclaude/collection-plugin/vue";
import { getPlugin } from "../../src/plugins-registry";

const SELF_CONTAINED = [formPlugin, brepPlugin, jingleScriptPlugin, GenerateImagePlugin.plugin];
const NOT = [markdownPlugin, chartPlugin, htmlPlugin, spreadsheetPlugin, collectionPlugin];

describe("the Views a remote cell's Canvas draws", () => {
  it.each(SELF_CONTAINED.map((p) => [p.toolDefinition.name, p] as const))("draws %s, its package's own View", (name, p) => {
    expect(getPlugin(name)?.selfContained).toBe(true);
    expect(getPlugin(name)?.viewComponent).toBe(p.viewComponent);
  });
  it.each([...NOT.map((p) => p.toolDefinition.name), "manageAccounting"])("does not draw %s", (name) => {
    expect(getPlugin(name)).toBeDefined();
    expect(getPlugin(name)?.selfContained).toBeUndefined();
  });
});
