import { describe, it, expect } from "vitest";

import { TOOL_GROUPS, isToolGroup, groupOfTool, toolGroupServerId, AUTO_ALLOWED_TOOLS, CANVAS_TOOL_GROUP } from "../../common/toolGroups.js";

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

// The launcher switch, the panel's availability check and the server all decide on this same
// group. Written as a literal at each site, a rename would break Canvas detection silently and
// with no type error — which is what the repo's "shared wire values live in common/" rule is for.
describe("CANVAS_TOOL_GROUP", () => {
  it("names a real group", () => {
    expect(TOOL_GROUPS).toContain(CANVAS_TOOL_GROUP);
  });

  it("is the group the drawing tools belong to", () => {
    expect(groupOfTool("presentDocument")).toBe(CANVAS_TOOL_GROUP);
    expect(groupOfTool("presentHtml")).toBe(CANVAS_TOOL_GROUP);
  });
});
