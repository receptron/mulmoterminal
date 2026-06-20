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
