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
  //        + project's MCP servers load normally — INCLUDING a GUI tool group the
  //        directory registered itself (see common/toolGroups.ts).
  attachGuiMcp: boolean;
  mcpConfig: string; // GUI MCP config JSON (--mcp-config), used only when attachGuiMcp
  // Comma-joined fully-qualified tool names for --allowedTools. Passed in BOTH modes: a grid
  // cell gets no --mcp-config, but still needs its render-group tools pre-approved so they
  // don't stop at a permission prompt on every call. Verified that --allowedTools alone (no
  // --mcp-config, no --strict-mcp-config) pre-approves without restricting anything else —
  // it is an additive allowlist, not "only these".
  allowedTools: string;
  // What this session runs (#579): an alias (sonnet/opus/haiku) or a backend's own model
  // name. Null leaves the choice to Claude Code. `--model` outranks both the settings
  // `model` key and ANTHROPIC_MODEL, so it is the one place the decision has to be made.
  model?: string | null;
  // Extra directories the session may read/edit (#908). Absolute, existing, deduped by the
  // config layer — this builder only places them.
  addDirs?: string[] | null | undefined;
  // What `--append-system-prompt` carries, already assembled (see appended-prompt.ts), or null
  // when every section of it is switched off — the flag is then left out entirely. Resolved by
  // the caller: which sections apply is a config decision, and this builder only places argv.
  //
  // Required, unlike the other optional fields: they default to adding nothing, while forgetting
  // this one would silently drop an instruction every session used to carry. A new spawn path has
  // to answer for it, and `null` is how it says no. `undefined` is in the type but the KEY is
  // still mandatory — a value that was never resolved can arrive, but a caller cannot omit it.
  appendedPrompt: string | null | undefined;
}

export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const guiArgs = ["--permission-mode", input.permissionMode];
  // Inline, not --append-system-prompt-file: the sandbox spawn runs in a container that cannot
  // read a host path, which is why --settings is already passed inline too. A prompt this size
  // is nowhere near the tmux arg limit that forced the seed prompt out of the argv (#942).
  if (input.appendedPrompt) guiArgs.push("--append-system-prompt", input.appendedPrompt);
  if (input.model) guiArgs.push("--model", input.model);
  if (input.attachGuiMcp) {
    guiArgs.push("--mcp-config", input.mcpConfig, "--strict-mcp-config");
  }
  // Outside the block: --strict-mcp-config is what makes --mcp-config the ONLY source, and a
  // grid cell wants neither — but it does want its render-group tools auto-allowed, and those
  // reach it through the user's own MCP config. Empty means nothing to pre-approve.
  if (input.allowedTools) guiArgs.push("--allowedTools", input.allowedTools);
  // LAST, and one flag for the whole list: `--add-dir` is variadic (`<directories...>`), so a
  // flag placed after it would be fine but a VALUE would be swallowed. Keeping it at the end
  // means nothing can ever follow it.
  if (input.addDirs?.length) guiArgs.push("--add-dir", ...input.addDirs);

  // No initial-prompt positional: an auto-run prompt is TYPED into the input box after
  // claude is ready (see spawnClaudePty), not passed as an arg — a large prompt as a
  // tmux `new-session` command arg overflows tmux's length limit ("command too long").
  return input.canResume && input.resume !== null
    ? ["--resume", input.resume, "--settings", input.settings, ...guiArgs]
    : ["--session-id", input.sessionId, "--settings", input.settings, ...guiArgs];
}
