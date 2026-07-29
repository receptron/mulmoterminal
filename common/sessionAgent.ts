// What a remote-host session is running. The server decides it (from the PtyEntry, or from
// what tmux says is in the pane) and the settings UI offers it as the scope for a quick
// command, so the list of kinds is a value both sides read.
export const SESSION_AGENTS = ["claude", "codex", "antigravity", "shell"] as const;

// Null anywhere this appears means the host cannot tell — a session that outlived a restart
// exists only in tmux, and nothing recorded what launched it. That is distinct from "shell".
export type SessionAgent = (typeof SESSION_AGENTS)[number];
