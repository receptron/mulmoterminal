// @vitest-environment node
//
// The reset's one hard case: a session RESUMED while the server is still hydrating.
//
// Hydration reads the log as it was before this spawn's reset marker could be appended, so
// unless the reset is remembered synchronously, hydration puts the superseded groups straight
// back — /api/tools then reports capabilities the newly spawned process does not have, and the
// Canvas button stays on after the user switched it off.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

const appended: string[] = [];

vi.mock("node:fs", () => {
  const promises = {
    // Every hydrator in the registry reads through this; only the tool-group log has content.
    readFile: vi.fn(async (file: string) => (String(file).endsWith("session-tool-groups.json") ? `${ID} render\n${OTHER} data` : "")),
    appendFile: vi.fn(async (_file: string, data: string) => {
      appended.push(data);
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

async function freshRegistry() {
  vi.resetModules();
  appended.length = 0;
  return import("../../../server/session/registry.js");
}

beforeEach(() => vi.clearAllMocks());

describe("resetSessionToolGroups against hydration", () => {
  // The race Codex found: the reset lands first, hydration second.
  it("keeps hydration from restoring what a spawn already superseded", async () => {
    const registry = await freshRegistry();
    // Synchronously, exactly as spawnClaudePty calls it — before hydration has resolved.
    registry.resetSessionToolGroups(ID);
    await registry.sessionToolGroupsHydrated;
    expect(registry.sessionToolGroups(ID)).toEqual([]);
  });

  // The marker is what survives to the NEXT restart, where a process-local memo is gone and the
  // log is replayed from scratch. Skipping it when memory "looks empty" was the bug.
  it("writes the marker even though nothing was learned in this process yet", async () => {
    const registry = await freshRegistry();
    registry.resetSessionToolGroups(ID);
    await registry.sessionToolGroupsHydrated;
    await new Promise((r) => setImmediate(r)); // let the append chain drain
    expect(appended).toContain(`\n${ID} -`);
  });

  it("leaves other sessions' hydrated groups alone", async () => {
    const registry = await freshRegistry();
    registry.resetSessionToolGroups(ID);
    await registry.sessionToolGroupsHydrated;
    expect(registry.sessionToolGroups(OTHER)).toEqual(["data"]);
  });

  // A cell whose MCP client connects fast can learn a group before hydration finishes; that is
  // the NEW process's capability and must not be swept away with the old one's.
  it("keeps a group learned after the reset", async () => {
    const registry = await freshRegistry();
    registry.resetSessionToolGroups(ID);
    registry.markSessionToolGroup(ID, "media");
    await registry.sessionToolGroupsHydrated;
    expect(registry.sessionToolGroups(ID)).toEqual(["media"]);
  });
});
