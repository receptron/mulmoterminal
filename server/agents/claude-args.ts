// Pure builder for the `claude` CLI argv. Kept separate so the exact flag set —
// especially the GUI-MCP / --strict-mcp-config switch — is unit-testable without
// spawning a PTY.

export interface ClaudeArgsInput {
  sessionId: string;
  resume: string | null;
  // Whether the requested session has an on-disk transcript to --resume. When
  // false we start fresh, reusing the id via --session-id.
  canResume: boolean;
  settings: string; // hook settings JSON (--settings)
  permissionMode: string; // --permission-mode
  // true  (single view): attach the in-process GUI MCP, auto-allow its tools, and
  //        isolate to it with --strict-mcp-config (main's classic behavior).
  // false (grid dev terminal): no GUI MCP and no --strict-mcp-config, so the user's
  //        + project's MCP servers load normally.
  attachGuiMcp: boolean;
  mcpConfig: string; // GUI MCP config JSON (--mcp-config), used only when attachGuiMcp
  guiMcpTools: string; // comma-joined GUI tool names (--allowedTools), used only when attachGuiMcp
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const guiArgs = ["--permission-mode", input.permissionMode];
  if (input.attachGuiMcp) {
    guiArgs.push("--mcp-config", input.mcpConfig, "--strict-mcp-config", "--allowedTools", input.guiMcpTools);
  }

  // No initial-prompt positional: an auto-run prompt is TYPED into the input box after
  // claude is ready (see spawnClaudePty), not passed as an arg — a large prompt as a
  // tmux `new-session` command arg overflows tmux's length limit ("command too long").
  return input.canResume && input.resume !== null
    ? ["--resume", input.resume, "--settings", input.settings, ...guiArgs]
    : ["--session-id", input.sessionId, "--settings", input.settings, ...guiArgs];
}
