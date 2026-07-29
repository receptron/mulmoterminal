import { describe, it, expect } from "vitest";

import {
  TOOL_GROUPS,
  isToolGroup,
  groupOfTool,
  toolsInGroup,
  toolGroupServerId,
  AUTO_ALLOWED_TOOLS,
  CANVAS_TOOL_GROUPS,
  TOOL_GROUP_HEADINGS,
  hasCanvasGroup,
} from "../../common/toolGroups.js";

describe("tool groups", () => {
  it("classifies the drawing tools as render", () => {
    expect(groupOfTool("presentDocument")).toBe("render");
    expect(groupOfTool("presentForm")).toBe("render");
    expect(groupOfTool("presentChart")).toBe("render");
    expect(groupOfTool("presentHtml")).toBe("render");
  });

  // The blast-radius split is the whole point of the grouping: only `render` is auto-allowed,
  // so a tool landing in the wrong group is a tool running without a permission prompt.
  it("keeps the tools with side effects out of render", () => {
    expect(groupOfTool("manageCollection")).toBe("data");
    expect(groupOfTool("manageAccounting")).toBe("data");
    expect(groupOfTool("generateImage")).toBe("media");
    expect(groupOfTool("presentMulmoScript")).toBe("media");
    expect(groupOfTool("google")).toBe("external");
    expect(groupOfTool("readXPost")).toBe("external");
    expect(groupOfTool("searchX")).toBe("external");
  });

  // The Canvas panel's empty state is built from this, so a group that under-reports its members
  // silently drops a tool from the only place the user can read about it.
  it("lists a group's members, and agrees with groupOfTool", () => {
    const render = toolsInGroup("render");
    expect(render).toContain("presentHtml");
    expect(render).toContain("presentChart");
    for (const tool of render) expect(groupOfTool(tool)).toBe("render");
    for (const group of TOOL_GROUPS) expect(toolsInGroup(group).length).toBeGreaterThan(0);
  });

  it("puts no tool in two groups", () => {
    const all = TOOL_GROUPS.flatMap((group) => toolsInGroup(group));
    expect(new Set(all).size).toBe(all.length);
  });

  // Absent on purpose, not by omission — it starts another session, which no group describes.
  it("leaves spawnBackgroundChat in no group", () => {
    expect(groupOfTool("spawnBackgroundChat")).toBeNull();
  });

  it("reports an unknown tool as ungrouped rather than throwing", () => {
    expect(groupOfTool("somePluginAddedTomorrow")).toBeNull();
  });

  // A prototype-chain lookup would resolve these to a function and hand back a truthy
  // "group" — the same trap the plugin dispatch map documents.
  it("does not resolve prototype members as a group", () => {
    expect(groupOfTool("constructor")).toBeNull();
    expect(groupOfTool("__proto__")).toBeNull();
    expect(groupOfTool("toString")).toBeNull();
  });

  it("names each group's expected MCP server id", () => {
    expect(toolGroupServerId("render")).toBe("mulmoterminal-render");
    expect(TOOL_GROUPS.map(toolGroupServerId)).toEqual(["mulmoterminal-render", "mulmoterminal-data", "mulmoterminal-media", "mulmoterminal-external"]);
  });

  // Per TOOL, not per group: "which tools may this directory reach" and "which may run without
  // asking" are different questions, and presentDocument is the case that forces them apart —
  // its execute resolves image placeholders through the image backend, a PAID call. Auto-
  // allowing it would let a model spend money under a switch labelled "let the agent draw".
  it("auto-allows only tools that call nothing external", () => {
    expect(AUTO_ALLOWED_TOOLS).toEqual(["presentForm", "presentChart", "presentHtml"]);
    expect(AUTO_ALLOWED_TOOLS).not.toContain("presentDocument");
  });

  // They still have to BE render tools — a directory that enabled Canvas is what grants them.
  it("auto-allows nothing outside the render group", () => {
    for (const name of AUTO_ALLOWED_TOOLS) expect(groupOfTool(name)).toBe("render");
  });

  it("accepts only the real group names", () => {
    expect(isToolGroup("render")).toBe(true);
    expect(isToolGroup("gui")).toBe(false);
    expect(isToolGroup(undefined)).toBe(false);
  });
});

// The launcher switches, the panel's availability check and the server all decide on these same
// groups. Written as literals at each site, a rename would break Canvas detection silently and
// with no type error — which is what the repo's "shared wire values live in common/" rule is for.
describe("CANVAS_TOOL_GROUPS", () => {
  it("names only real groups", () => {
    for (const group of CANVAS_TOOL_GROUPS) expect(TOOL_GROUPS).toContain(group);
  });

  // Both groups DRAW into the same pane; they are two switches because a media call costs money
  // and writes files where a render call stops at the pane.
  it("covers the drawing tools of both groups", () => {
    expect(CANVAS_TOOL_GROUPS).toContain(groupOfTool("presentHtml"));
    expect(CANVAS_TOOL_GROUPS).toContain(groupOfTool("presentDocument"));
    expect(CANVAS_TOOL_GROUPS).toContain(groupOfTool("generateImage"));
    expect(CANVAS_TOOL_GROUPS).toContain(groupOfTool("presentMulmoScript"));
  });

  // The groups a session cannot draw with. Counting one of them would open a Canvas pane that
  // nothing can ever fill.
  it("leaves out the groups that draw nothing", () => {
    expect(CANVAS_TOOL_GROUPS).not.toContain("data");
    expect(CANVAS_TOOL_GROUPS).not.toContain("external");
  });

  // Asked of whatever the server reported, which arrives as untyped JSON.
  it("detects a canvas group in a reported group list", () => {
    expect(hasCanvasGroup(["render"])).toBe(true);
    expect(hasCanvasGroup(["data", "media"])).toBe(true);
    expect(hasCanvasGroup(["data", "external"])).toBe(false);
    expect(hasCanvasGroup([])).toBe(false);
    expect(hasCanvasGroup(["renderer"])).toBe(false);
    expect(hasCanvasGroup(undefined)).toBe(false);
    expect(hasCanvasGroup("render")).toBe(false);
  });
});

// The launcher draws one switch per group and labels it from here. A group with no heading would
// render a blank label, and the Record type only catches that for a group added in the same
// commit as its heading — this catches the value being emptied.
describe("TOOL_GROUP_HEADINGS", () => {
  it("names every group", () => {
    for (const group of TOOL_GROUPS) expect(TOOL_GROUP_HEADINGS[group]?.trim()).toBeTruthy();
  });

  // The two groups that draw share a heading on purpose — they are one feature with two costs.
  it("gives the drawing groups the Canvas heading", () => {
    for (const group of CANVAS_TOOL_GROUPS) expect(TOOL_GROUP_HEADINGS[group]).toBe("Canvas");
    expect(TOOL_GROUP_HEADINGS.data).not.toBe("Canvas");
    expect(TOOL_GROUP_HEADINGS.external).not.toBe("Canvas");
  });
});
