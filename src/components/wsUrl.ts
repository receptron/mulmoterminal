// Pure builder for the terminal WebSocket URL. Kept separate from Terminal.vue so
// the query it sends — including ?gui=0, which tells the server to run a plain dev
// terminal (no GUI MCP) — is unit-testable without xterm/WebSocket.

export interface TerminalWsUrlInput {
  host: string; // location.host
  secure: boolean; // location.protocol === "https:"
  sessionId: string | null; // resume this session; null => fresh session
  cwd?: string | null; // launch in this directory
  devTerminal?: boolean; // grid dev terminal: no GUI MCP (?gui=0)
}

export function buildTerminalWsUrl({ host, secure, sessionId, cwd, devTerminal }: TerminalWsUrlInput): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (cwd) params.set("cwd", cwd);
  if (devTerminal) params.set("gui", "0");
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";
  const proto = secure ? "wss:" : "ws:";
  return `${proto}//${host}/ws${suffix}`;
}

export interface RunWsUrlInput {
  host: string; // location.host
  secure: boolean; // location.protocol === "https:"
  index: number; // position in the directory's script.json (the server resolves it)
  cwd?: string | null; // the directory whose script.json the index refers to
}

// The command-terminal endpoint (a cell's launcher Run). The browser sends only the
// script INDEX + its directory — the server reads <cwd>/script.json (the run
// allowlist), resolves the command, and runs it in <cwd>.
export function buildRunWsUrl({ host, secure, index, cwd }: RunWsUrlInput): string {
  const params = new URLSearchParams();
  params.set("index", String(index));
  if (cwd) params.set("cwd", cwd);
  const proto = secure ? "wss:" : "ws:";
  return `${proto}//${host}/ws/run?${params.toString()}`;
}

export interface LaunchWsUrlInput {
  host: string;
  secure: boolean;
  sessionId: string | null; // reattach this persistent launcher session; null => fresh
  cwd?: string | null;
  launcher: number; // position in the configured launcher list (the server resolves it)
}

// The launcher-terminal endpoint (a configured shell/codex/command). Persistent &
// reattachable like /ws: the browser sends the launcher INDEX (config is the allowlist)
// plus the session id to reattach. On a cold spawn the server resolves the index.
export function buildLaunchWsUrl({ host, secure, sessionId, cwd, launcher }: LaunchWsUrlInput): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (cwd) params.set("cwd", cwd);
  params.set("launcher", String(launcher));
  const proto = secure ? "wss:" : "ws:";
  return `${proto}//${host}/ws/launch?${params.toString()}`;
}

export interface CodexWsUrlInput {
  host: string;
  secure: boolean;
  sessionId: string | null; // reattach/resume this codex session; null => fresh
  cwd?: string | null;
  devTerminal?: boolean; // grid dev terminal: no GUI MCP (?gui=0). Single view omits it => GUI MCP.
}

// The codex-terminal endpoint (a first-class codex session). Persistent & reattachable like
// /ws; the browser sends the mulmoterminal session id to reattach/resume — the server maps it
// to codex's own rollout id. ?gui=0 (grid) runs codex without the GUI MCP.
export function buildCodexWsUrl({ host, secure, sessionId, cwd, devTerminal }: CodexWsUrlInput): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (cwd) params.set("cwd", cwd);
  if (devTerminal) params.set("gui", "0");
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";
  const proto = secure ? "wss:" : "ws:";
  return `${proto}//${host}/ws/codex${suffix}`;
}
