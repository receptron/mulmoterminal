// Builds the argv for spawning codex as a first-class session. codex mints its own session id
// (there is no `--session-id` like claude has), so a fresh session passes no id — the id is read
// back from the rollout file afterwards — while resume replays a known rollout id via the
// `resume` subcommand. Global flags precede the subcommand (codex's clap layout).
export interface CodexArgsInput {
  // A codex rollout id to resume, or null to start a fresh session.
  resume: string | null;
  // Model override (--model), or null to use codex's own configured default.
  model: string | null;
  // The in-process GUI MCP endpoint to attach (single view), or null (grid dev terminal / no GUI).
  guiMcpUrl: string | null;
  // A prompt to auto-run as the session's first turn (codex's positional [PROMPT]), or null for an
  // interactive session with no seed. codex has no --system-prompt, so any instructions must already
  // be part of this text.
  initialPrompt: string | null;
}

export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  if (input.guiMcpUrl) {
    // Attach the GUI MCP over streamable HTTP and auto-approve its tools so codex can drive the
    // GUI panel without a per-call permission prompt. `-c` takes dotted TOML keys; the value is
    // parsed as TOML (hence the quotes). No shell is involved (node-pty spawns codex directly),
    // so the URL needs no escaping.
    args.push("-c", `mcp_servers.mulmoterminal-gui.url="${input.guiMcpUrl}"`);
    args.push("-c", `mcp_servers.mulmoterminal-gui.default_tools_approval_mode="approve"`);
  }
  if (input.resume) args.push("resume", input.resume);
  // The positional PROMPT goes last — for `codex [OPTS] [PROMPT]` and `codex resume <id> [PROMPT]`.
  if (input.initialPrompt) args.push(input.initialPrompt);
  return args;
}
