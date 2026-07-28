// Builds the argv for spawning codex as a first-class session. codex mints its own session id
// (there is no `--session-id` like claude has), so a fresh session passes no id — the id is read
// back from the rollout file afterwards — while resume replays a known rollout id via the
// `resume` subcommand. Global flags precede the subcommand (codex's clap layout).
export interface GuiMcpServer {
  /** The MCP server id codex registers it under — `mulmoterminal-gui`, or `mulmoterminal-<group>`. */
  id: string;
  url: string;
}

export interface CodexArgsInput {
  // A codex rollout id to resume, or null to start a fresh session.
  resume: string | null;
  // Model override (--model), or null to use codex's own configured default.
  model: string | null;
  // The in-process GUI MCP endpoints to attach, or empty (no GUI tools).
  //
  // One entry for the single view (`mulmoterminal-gui`, every tool) and one PER GROUP for a grid
  // cell, because that is the shape of the two surfaces: the single view carries the whole GUI
  // MCP, while a grid cell gets exactly the groups its directory registered.
  //
  // claude reaches the same group URLs through its own per-folder config, where the URL may
  // contain `${VAR}` and is expanded at connect time. codex has no such expansion, so these
  // arrive already resolved — the port and session id are known by the time we spawn.
  guiMcpServers: readonly GuiMcpServer[];
}

// NOTE: a seed prompt is NOT passed here as a positional [PROMPT] — a long collection-action prompt
// overflows tmux's new-session command-length limit ("command too long"). It is typed into codex's
// input box after startup instead (see attachCodexAutoRun in index.ts).
export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  for (const server of input.guiMcpServers) {
    // Attach the GUI MCP over streamable HTTP and auto-approve its tools so codex can drive the
    // GUI panel without a per-call permission prompt. `-c` takes dotted TOML keys; the value is
    // parsed as TOML, so the quotes are part of the value's syntax and have to arrive intact.
    //
    // They no longer travel untouched everywhere: a `.cmd`-installed codex on Windows is
    // launched through cmd.exe (#801), which puts a second parser between here and codex. The
    // Windows spec spawns these exact arguments through a shim and compares the argv that
    // comes out — lose the quotes and the value stops being a TOML string.
    //
    // Auto-approval is per server id, so it is repeated rather than set once: a group the user
    // enabled and codex then asks permission for on every call is the same friction the single
    // view was given this flag to avoid.
    args.push("-c", `mcp_servers.${server.id}.url="${server.url}"`);
    args.push("-c", `mcp_servers.${server.id}.default_tools_approval_mode="approve"`);
  }
  if (input.resume) args.push("resume", input.resume);
  return args;
}
