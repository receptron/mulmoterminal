// The past sessions of an open terminal's directory, and their conversations (#2999). Read-only:
// the phone browses them; resuming one stays the grid's job.
//
// No MulmoClaude counterpart: that host has no per-directory agent sessions to list.
import { toJsonObject, type CommandHandlers, type JsonObject } from "@mulmoclaude/core/remote-host";
import { sessionIdOf } from "./terminalSession.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

// Absent, null and "" all mean the newest page. Anything else that is not a string is a client bug,
// and answering it with the newest page would have the phone append turns it already holds.
const cursorOf = (params: JsonObject): string | null => {
  const { before } = params;
  if (before === undefined || before === null || before === "") return null;
  if (typeof before !== "string") throw new Error("before must be a string");
  return before;
};

export const createPastSessionHandlers = ({
  listPastSessions,
  readPastTranscript,
}: Pick<RemoteHostHandlerDeps, "listPastSessions" | "readPastTranscript">): CommandHandlers => ({
  // The phone names the OPEN session; the host looks its directory up, as for launchTerminal (#831).
  listPastSessions: async (params: JsonObject) => toJsonObject(await listPastSessions(sessionIdOf(params))),

  // One page, newest first; `older` on the answer is the `before` for the page before it. Only an id
  // that directory's list holds is read — the reader refuses the rest.
  getPastTranscript: async (params: JsonObject) => {
    const sessionId = sessionIdOf(params);
    const pastSessionId = typeof params.pastSessionId === "string" ? params.pastSessionId : "";
    if (!pastSessionId) throw new Error("pastSessionId is required");
    return toJsonObject(await readPastTranscript(sessionId, pastSessionId, cursorOf(params)));
  },
});
