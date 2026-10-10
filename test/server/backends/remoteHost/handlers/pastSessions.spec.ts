// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { JsonObject } from "@mulmoclaude/core/remote-host";
import { createPastSessionHandlers } from "../../../../../server/backends/remoteHost/handlers/pastSessions";

const OPEN = "11111111-2222-4333-8444-555555555555";
const PAST = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function setup() {
  const reads: { sessionId: string; pastSessionId: string; before: string | null }[] = [];
  const deps: Parameters<typeof createPastSessionHandlers>[0] = {
    listPastSessions: async (sessionId) => ({ cwd: "/work", sessions: [{ id: PAST, title: `from ${sessionId}`, mtime: 1, agent: "claude", readable: true }] }),
    readPastTranscript: async (sessionId, pastSessionId, before) => {
      reads.push({ sessionId, pastSessionId, before });
      return { view: { status: "none" }, older: null };
    },
  };
  const handlers = createPastSessionHandlers(deps);
  const call = async (name: string, params: JsonObject) => {
    const handler = handlers[name];
    if (!handler) throw new Error(`no handler ${name}`);
    return handler(params);
  };
  return { call, reads };
}

describe("listPastSessions", () => {
  it("answers the directory's rows for an open session", async () => {
    const { call } = setup();
    expect(await call("listPastSessions", { sessionId: OPEN })).toEqual({
      cwd: "/work",
      sessions: [{ id: PAST, title: `from ${OPEN}`, mtime: 1, agent: "claude", readable: true }],
    });
  });

  it("refuses a missing or malformed session id", async () => {
    const { call } = setup();
    await expect(call("listPastSessions", {})).rejects.toThrow("sessionId is required");
    await expect(call("listPastSessions", { sessionId: OPEN.slice(0, 8) })).rejects.toThrow("not a session id");
  });
});

describe("getPastTranscript", () => {
  it("reads the newest page when no cursor is given, and passes a cursor through verbatim", async () => {
    const { call, reads } = setup();
    await call("getPastTranscript", { sessionId: OPEN, pastSessionId: PAST });
    await call("getPastTranscript", { sessionId: OPEN, pastSessionId: PAST, before: "" });
    await call("getPastTranscript", { sessionId: OPEN, pastSessionId: PAST, before: null });
    await call("getPastTranscript", { sessionId: OPEN, pastSessionId: PAST, before: "claude:123" });
    expect(reads.map((r) => r.before)).toEqual([null, null, null, "claude:123"]);
  });

  it("refuses a missing past id, a non-string cursor and a malformed open session id", async () => {
    const { call, reads } = setup();
    await expect(call("getPastTranscript", { sessionId: OPEN })).rejects.toThrow("pastSessionId is required");
    await expect(call("getPastTranscript", { sessionId: OPEN, pastSessionId: 5 })).rejects.toThrow("pastSessionId is required");
    await expect(call("getPastTranscript", { sessionId: OPEN, pastSessionId: PAST, before: 3 })).rejects.toThrow("before must be a string");
    await expect(call("getPastTranscript", { sessionId: "../x", pastSessionId: PAST })).rejects.toThrow("not a session id");
    expect(reads).toEqual([]);
  });
});
