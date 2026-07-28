import { describe, it, expect } from "vitest";

import { TOOL_GROUPS, groupOfTool } from "../../../common/toolGroups.js";
import { toolSummaries } from "../../../server/infra/plugins-registry.js";

// The map is hand-maintained against the registry, so it can silently fall behind. This is the
// one check that notices — it does not force a classification (ungrouped is a legal answer),
// it only pins WHICH tools are currently unclassified, so adding a plugin without deciding
// where it belongs fails here rather than quietly never appearing on a group URL.
describe("the group map against the real registry", () => {
  it("leaves exactly the tools we meant to leave ungrouped", () => {
    const ungrouped = toolSummaries.map((t) => t.toolName).filter((name) => groupOfTool(name) === null);
    expect(ungrouped).toEqual(["spawnBackgroundChat"]);
  });

  it("classifies every tool it does classify into a real group", () => {
    for (const { toolName } of toolSummaries) {
      const group = groupOfTool(toolName);
      if (group !== null) expect(TOOL_GROUPS).toContain(group);
    }
  });
});
