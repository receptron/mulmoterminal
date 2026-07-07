// The per-agent surface a hosted coding-agent CLI needs; shared plumbing (PTY, grid, GUI-MCP) stays out.
export type AgentKind = "claude";

export interface AgentAdapter {
  readonly kind: AgentKind;
  // Executable to spawn; reads a per-agent env override (e.g. CLAUDE_BIN) at call time.
  bin(): string;
  // TUI status line signalling the input box is ready for bracketed-paste draft typing.
  readonly draftReadyMarker: RegExp;
}
