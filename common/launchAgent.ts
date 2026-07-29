// What the phone may ask the grid to start in a session's directory (#831). The host
// validates against this list and the grid turns each into a cell, so both sides read it.
//
// Deliberately NOT the configured `launchers` list: those are arbitrary user commands, and
// the phone picks from a fixed set the host can name. "shell" is the OS default shell, the
// same thing the header's new-terminal button opens.
export const LAUNCH_AGENTS = ["shell", "claude", "codex", "antigravity"] as const;

export type LaunchAgent = (typeof LAUNCH_AGENTS)[number];

export const isLaunchAgent = (value: unknown): value is LaunchAgent => LAUNCH_AGENTS.some((agent) => agent === value);

// The pub/sub channel the grid listens on for these requests. The grid is browser state, so
// the host cannot open a cell itself — it asks whichever tab is connected.
export const LAUNCH_TERMINAL_CHANNEL = "launch-terminal";
