// Process-wide settings read from the environment. Their own module because the session
// registry persists under MULMOTERMINAL_HOME and validates ids with SESSION_ID_RE — taking
// them from index.ts would make the registry import its own importer.
import os from "node:os";
import path from "node:path";

export const PORT = process.env.PORT || 34567;

// The workspace used as the PTY cwd and as the root for persisted session state. index.ts
// creates it at boot before anything spawns into it.
export const CLAUDE_CWD = process.env.CLAUDE_CWD || path.join(os.homedir(), "mulmoclaude");

// MulmoTerminal's own per-session GUI state (tool-result render data + tool-call history)
// lives here, keyed by sessionId (a global UUID) — NOT under the workspace dir, so it stays
// valid regardless of which directory is active.
export const MULMOTERMINAL_HOME = path.join(os.homedir(), ".mulmoterminal");

// A session id is always a UUID (server-generated, or a .jsonl basename). Reject anything
// else so a client can't smuggle CLI flags (e.g. "--resume" followed by a value that claude
// re-parses as a flag) into the spawned process.
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
