import { describe, it, expect } from "vitest";

import { narrowedTools, type ToolSummary } from "../../../server/routes/tool-routes.js";

const TOOLS: ToolSummary[] = [
  { toolName: "presentDocument", title: "presentDocument" },
  { toolName: "presentHtml", title: "presentHtml" },
  { toolName: "manageCollection", title: "manageCollection" },
  { toolName: "generateImage", title: "generateImage" },
  { toolName: "spawnBackgroundChat", title: "spawnBackgroundChat" },
];
const names = (tools: ToolSummary[]) => tools.map((t) => t.toolName);

describe("narrowedTools", () => {
  // REGRESSION. An empty group list means opposite things for the two kinds of session, and
  // treating both as "cannot narrow, answer with everything" reported the full tool list for a
  // grid cell whose directory had registered no MCP at all — so the UI offered a Canvas button
  // that opened a panel nothing could ever fill.
  it("gives a grid cell with nothing registered nothing", () => {
    expect(narrowedTools(TOOLS, [], true)).toEqual([]);
  });

  // The single view carries the whole GUI MCP on --mcp-config and never connects to a group
  // URL, so it learns no groups and nonetheless has every tool. Same empty list, opposite answer.
  it("gives a non-grid session everything, groups or not", () => {
    expect(names(narrowedTools(TOOLS, [], false))).toEqual(names(TOOLS));
  });

  it("gives a grid cell exactly the groups it reached us on", () => {
    expect(names(narrowedTools(TOOLS, ["render"], true))).toEqual(["presentDocument", "presentHtml"]);
    expect(names(narrowedTools(TOOLS, ["render", "media"], true))).toEqual(["presentDocument", "presentHtml", "generateImage"]);
  });

  // Ungrouped tools reach no group URL, so a grid cell cannot have one however many groups it
  // registered — only the un-narrowed answer lists them.
  it("never gives a grid cell an ungrouped tool", () => {
    const all = narrowedTools(TOOLS, ["render", "data", "media", "external"], true);
    expect(names(all)).not.toContain("spawnBackgroundChat");
    expect(names(narrowedTools(TOOLS, [], false))).toContain("spawnBackgroundChat");
  });

  it("does not mutate the list it was given", () => {
    narrowedTools(TOOLS, ["render"], true);
    expect(TOOLS).toHaveLength(5);
  });
});
