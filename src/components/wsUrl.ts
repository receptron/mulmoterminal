// Pure builder for the terminal WebSocket URL. Kept separate from Terminal.vue so
// the query it sends — including ?gui=0, which tells the server to run a plain dev
// terminal (no GUI MCP) — is unit-testable without xterm/WebSocket.

// What the launch form picked for THIS session (#584), overriding the directory's own
// default. Either half may be absent: a bare model is a valid pick on the default
// Anthropic backend.
export interface LaunchChoice {
  provider?: string | null;
  model?: string | null;
}

export interface TerminalWsUrlInput {
  host: string; // location.host
  secure: boolean; // location.protocol === "https:"
  sessionId: string | null; // resume this session; null => fresh session
  cwd?: string | null; // launch in this directory
  devTerminal?: boolean; // grid dev terminal: no GUI MCP (?gui=0)
  launch?: LaunchChoice | null; // picked at launch; absent => the directory's default
}

// The two session-terminal endpoints (/ws for claude, /ws/codex for codex) send the
// identical session/cwd/gui query, so they share this assembly — only the path differs.
function sessionTerminalWsUrl(path: string, { host, secure, sessionId, cwd, devTerminal, launch }: TerminalWsUrlInput): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (cwd) params.set("cwd", cwd);
  if (devTerminal) params.set("gui", "0");
  // Only sent when the user picked one — an absent param is what tells the server to use
  // the directory's own provider/model.
  if (launch?.provider) params.set("provider", launch.provider);
  if (launch?.model) params.set("model", launch.model);
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";
  const proto = secure ? "wss:" : "ws:";
  return `${proto}//${host}/${path}${suffix}`;
}

export function buildTerminalWsUrl(input: TerminalWsUrlInput): string {
  return sessionTerminalWsUrl("ws", input);
}

export type RunWsUrlInput = { host: string; secure: boolean; cwd?: string | null } & (
  | { index: number } // position in the directory's script.json (the server resolves it)
  | { buttonId: string; session: string | null; agent: "claude" | "codex"; model: string | null } // a header run:"shell" button, re-resolved server-side
);

// The command-terminal endpoint. The browser sends only a REFERENCE — a script INDEX
// or a header button id (+ the session context to resolve it against) — never a raw
// command; the server reads the allowlist (<cwd>/script.json or the merged header
// config), resolves the command, and runs it in <cwd>.
export function buildRunWsUrl(input: RunWsUrlInput): string {
  const params = new URLSearchParams();
  if ("buttonId" in input) {
    params.set("buttonId", input.buttonId);
    if (input.session) params.set("session", input.session);
    params.set("agent", input.agent);
    if (input.model) params.set("model", input.model);
  } else {
    params.set("index", String(input.index));
  }
  if (input.cwd) params.set("cwd", input.cwd);
  const proto = input.secure ? "wss:" : "ws:";
  return `${proto}//${input.host}/ws/run?${params.toString()}`;
}

export interface LaunchWsUrlInput {
  host: string;
  secure: boolean;
  sessionId: string | null; // reattach this persistent launcher session; null => fresh
  cwd?: string | null;
  launcher?: number; // position in the configured launcher list (the server resolves it)
  shell?: boolean; // run the OS default shell ($SHELL) — no configured index (the header "new terminal" button)
}

// The launcher-terminal endpoint (a configured shell/codex/command, or the OS default shell).
// Persistent & reattachable like /ws: the browser sends the launcher INDEX (config is the allowlist)
// — or `shell=1` for the OS default shell, which needs no index — plus the session id to reattach.
export function buildLaunchWsUrl({ host, secure, sessionId, cwd, launcher, shell }: LaunchWsUrlInput): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (cwd) params.set("cwd", cwd);
  if (shell) params.set("shell", "1");
  else params.set("launcher", String(launcher));
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
export function buildCodexWsUrl(input: CodexWsUrlInput): string {
  return sessionTerminalWsUrl("ws/codex", input);
}
