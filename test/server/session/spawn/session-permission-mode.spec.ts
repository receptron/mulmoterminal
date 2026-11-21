// @vitest-environment node
// A Library promotion starts in plan mode (#3334), and a resume of it must too: the reconnect that
// resumes it names no mode, so the mode is recorded per session id, on disk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { permissionModeLine, permissionModeRecord } from "../../../../server/session/spawn/agents/permission-mode-log.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const isValidSessionId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

describe("the permission mode log", () => {
  it("round-trips a record, one line each", () => {
    const line = permissionModeLine({ sessionId: ID, permissionMode: "plan" });
    expect(line).toMatch(/^[^\n]*\n$/);
    expect(permissionModeRecord(JSON.parse(line), isValidSessionId)).toEqual({ sessionId: ID, permissionMode: "plan" });
  });

  it("drops a line with no usable session id or mode", () => {
    for (const parsed of [
      { sessionId: "nope", permissionMode: "plan" },
      { permissionMode: "plan" },
      { sessionId: ID },
      { sessionId: ID, permissionMode: "" },
      { sessionId: ID, permissionMode: "plan --dangerously-skip-permissions" },
      { sessionId: ID, permissionMode: 3 },
      { sessionId: 7, permissionMode: "plan" },
    ]) {
      expect(permissionModeRecord(parsed, isValidSessionId)).toBeNull();
    }
  });
});

describe("sessionPermissionMode", () => {
  let home = "";
  const file = () => path.join(home, "session-permission-modes.jsonl");
  const load = async () => {
    vi.resetModules();
    vi.doMock("../../../../server/config/env.js", async (importOriginal) => ({ ...(await importOriginal<object>()), MULMOTERMINAL_HOME: home }));
    const store = await import("../../../../server/session/spawn/agents/session-permission-mode.js");
    await store.sessionPermissionModesHydrated;
    return store;
  };
  const persisted = async () => {
    const { whenSessionStatePersisted } = await import("../../../../server/session/reaping/persist-drain.js");
    await whenSessionStatePersisted();
  };

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "mt-permission-modes-"));
  });
  afterEach(async () => {
    vi.doUnmock("../../../../server/config/env.js");
    await rm(home, { recursive: true, force: true });
  });

  it("is null for a session never started in a mode of its own", async () => {
    const { sessionPermissionMode } = await load();
    expect(sessionPermissionMode(ID, undefined)).toBeNull();
  });

  it("keeps the mode asked for, for a later spawn that asks for none", async () => {
    const { sessionPermissionMode } = await load();
    expect(sessionPermissionMode(ID, "plan")).toBe("plan");
    expect(sessionPermissionMode(ID, undefined)).toBe("plan");
    expect(sessionPermissionMode(OTHER, undefined)).toBeNull();
  });

  it("survives a restart, and writes one line however often the same mode is asked for", async () => {
    const first = await load();
    first.sessionPermissionMode(ID, "plan");
    first.sessionPermissionMode(ID, "plan");
    await persisted();
    expect((await readFile(file(), "utf8")).trim().split("\n")).toHaveLength(1);
    const restarted = await load();
    expect(restarted.sessionPermissionMode(ID, undefined)).toBe("plan");
  });

  it("skips a broken line rather than losing the rest", async () => {
    await writeFile(file(), ["not json", JSON.stringify({ sessionId: ID, permissionMode: "plan" }), ""].join("\n"));
    const { sessionPermissionMode } = await load();
    expect(sessionPermissionMode(ID, undefined)).toBe("plan");
  });
});
