import { describe, it, expect } from "vitest";

import { TOOL_GROUPS, isToolGroup, groupOfTool, toolGroupServerId, AUTO_ALLOWED_TOOL_GROUPS } from "../../common/toolGroups.js";

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

  it("auto-allows render and nothing else", () => {
    expect(AUTO_ALLOWED_TOOL_GROUPS).toEqual(["render"]);
  });

  it("accepts only the real group names", () => {
    expect(isToolGroup("render")).toBe(true);
    expect(isToolGroup("gui")).toBe(false);
    expect(isToolGroup(undefined)).toBe(false);
  });
});
