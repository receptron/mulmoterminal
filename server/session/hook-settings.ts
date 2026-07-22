// The `claude --settings` payload every spawned session carries.
//
// Each hook event POSTs the full payload to /api/hook: UserPromptSubmit => working,
// Stop => idle, Notification => waiting for input. PreToolUse / PostToolUse /
// PostToolUseFailure (matcher "" => every tool, including built-ins and MCP tools) feed the
// per-session tool-call history the GUI's tools pane shows. A failed tool fires
// PostToolUseFailure and NOT PostToolUse, so both are registered — otherwise a failed call
// would stay stuck on "running".
//
// Pure, with the port passed in: index.ts built this against a module-level PORT, which left
// the shape of the settings — including the env block that carries a provider's token —
// reachable only by booting the server (#548).

export interface HookSettingsInput {
  // Where the session should reach this server. Differs per spawn: a container cannot use
  // loopback, so the sandbox passes its own gateway host.
  host: string;
  port: string | number;
  sessionId: string;
  // Aims a provider session at its backend (#579). Claude Code applies this block itself, so
  // it lands identically on the host, under tmux — where a pane inherits the tmux SERVER's
  // environment, not ours — and inside a container. Omitted entirely when empty, so a
  // non-provider session's settings stay free of anything secret.
  env?: Record<string, string>;
}

// Tag every hook with mulmoterminal's STABLE session id via a header. Claude reissues its own
// session_id on /clear and /compact, but the PTY — and the id the client tracks — stays this
// one, so attributing hooks by this header keeps activity / header prompt / tool history
// correlated across a clear.
//
// The id is interpolated into a shell command inside single quotes. Every caller takes its id
// from randomUUID() or a SESSION_ID_RE match, so a quote cannot reach here; the assertion is
// in the tests rather than a runtime check, because a session id that got this far malformed
// is a bug upstream and not something to paper over.
const hookCommand = (host: string, port: string | number, sessionId: string): string =>
  `curl -s -X POST http://${host}:${port}/api/hook ` + `-H 'content-type: application/json' -H 'x-mt-session: ${sessionId}' -d @- >/dev/null 2>&1`;

export function hookSettingsJson({ host, port, sessionId, env = {} }: HookSettingsInput): string {
  const cmd = hookCommand(host, port, sessionId);
  const entry = [{ hooks: [{ type: "command", command: cmd }] }];
  // Tool hooks take a matcher; "" matches all tools.
  const toolEntry = [{ matcher: "", hooks: [{ type: "command", command: cmd }] }];
  return JSON.stringify({
    ...(Object.keys(env).length ? { env } : {}),
    hooks: {
      UserPromptSubmit: entry,
      Stop: entry,
      Notification: entry,
      // SessionStart fires with source "clear" on /clear — used to reset the header prompt.
      SessionStart: entry,
      PreToolUse: toolEntry,
      PostToolUse: toolEntry,
      PostToolUseFailure: toolEntry,
    },
  });
}
