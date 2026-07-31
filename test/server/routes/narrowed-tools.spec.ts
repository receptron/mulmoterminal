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

  // Ungrouped tools reach no group URL, so a grid cell that registered its tools a group at a
  // time cannot have one — however many groups it registered.
  it("does not give an ungrouped tool to a cell that registered groups", () => {
    const all = narrowedTools(TOOLS, ["render", "data", "media", "external"], true);
    expect(names(all)).not.toContain("spawnBackgroundChat");
    expect(names(narrowedTools(TOOLS, [], false))).toContain("spawnBackgroundChat");
  });

  // ...but a grid cell CAN carry the whole GUI MCP now — a workspace cell does, and so does an
  // adopted chat — and then it really does have the ungrouped tools. Reported live:
  // spawnBackgroundChat was missing from a cell that could call it, because "is a grid cell" was
  // standing in for "has only what its directory registered", and those came apart.
  it("gives a grid cell everything when it carries the whole GUI MCP", () => {
    expect(names(narrowedTools(TOOLS, ["render", "data", "media", "external"], true, true))).toEqual(names(TOOLS));
    // The groups it happens to have learned are irrelevant to that: the full MCP is the fact.
    expect(names(narrowedTools(TOOLS, [], true, true))).toEqual(names(TOOLS));
  });

  // The distinction the flag exists for. Four groups is not the same statement as the whole MCP.
  it("tells a four-group directory apart from a session with the whole MCP", () => {
    const registered = narrowedTools(TOOLS, ["render", "data", "media", "external"], true, false);
    const whole = narrowedTools(TOOLS, ["render", "data", "media", "external"], true, true);
    expect(names(whole)).toContain("spawnBackgroundChat");
    expect(names(registered)).not.toContain("spawnBackgroundChat");
    // Everything else is common to both — only the ungrouped tools differ.
    expect(names(registered)).toEqual(names(whole).filter((n) => n !== "spawnBackgroundChat"));
  });

  it("does not mutate the list it was given", () => {
    narrowedTools(TOOLS, ["render"], true);
    expect(TOOLS).toHaveLength(5);
  });
});
