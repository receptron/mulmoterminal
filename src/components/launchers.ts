// A user-configured launch command offered in the grid cell launcher (mirrors the
// server's Launcher in app-config.ts). `command` runs as an interactive persistent
// PTY; `label` is what the launcher button and the cell header show.
export interface Launcher {
  label: string;
  command: string;
}

// What a cell launcher emits when the user picks a program to launch: the launcher's
// position in the configured list (the server's allowlist) + its label, plus the dir.
export interface LaunchPick {
  index: number;
  label: string;
  cwd: string | null;
}
