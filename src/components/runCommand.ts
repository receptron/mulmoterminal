// A command run in an ephemeral command cell. Two sources, both resolved server-side (the browser never
// holds a raw command): a `script.json` entry by index, or a header `run:"shell"` button by id — the
// latter is re-resolved against the live session context (cwd/session/agent/model) at exec time. `label`
// and `cwd` are common to both, so display code doesn't need to branch.
export type RunCommand =
  | { source: "script"; index: number; label: string; cwd: string | null }
  | {
      source: "button";
      buttonId: string;
      label: string;
      cwd: string | null;
      session: string | null;
      agent: "claude" | "codex";
      model: string | null;
    };
