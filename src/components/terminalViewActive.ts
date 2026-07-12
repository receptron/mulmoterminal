// Pure decision for the `view` frame a terminal reports to the server (see the WS
// protocol in server/index.ts). Split out from Terminal.vue so the rules are unit-
// testable independent of the xterm/keep-alive machinery.

// A command (Run) or launcher terminal has no Claude/Codex attention hooks, so it
// never reports a view state — the server has nothing to gate on it.
export function terminalManagesAttention(command: boolean, launcher: boolean): boolean {
  return !command && !launcher;
}

// Whether this terminal is the user's actively-viewed pane while shown: a grid
// dev-terminal cell counts only while zoomed (so unfocused cells can surface
// blocked/done); the single view counts whenever it's on screen.
export function terminalViewActive(devTerminal: boolean, expanded: boolean): boolean {
  return devTerminal ? expanded : true;
}
