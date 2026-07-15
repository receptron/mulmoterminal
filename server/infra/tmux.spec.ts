import { describe, it, expect } from "vitest";
import { tmuxSessionName, tmuxNewSessionArgs, TMUX_CONF_LINES, isResumableTmuxSession } from "./tmux";

describe("tmuxSessionName", () => {
  it("prefixes the session id", () => {
    expect(tmuxSessionName("abc-123")).toBe("mt-abc-123");
  });
});

describe("tmuxNewSessionArgs", () => {
  const args = tmuxNewSessionArgs("id1", "/bin/zsh", ["-lc", "exec codex"], "/proj");

  it("targets our isolated tmux server and config", () => {
    expect(args.slice(0, 4)).toEqual(["-L", "mulmoterminal", "-f", expect.stringMatching(/tmux\.conf$/)]);
  });
  it("uses new-session -A (create-or-attach) with the mt- session name and cwd", () => {
    expect(args).toContain("new-session");
    expect(args).toContain("-A");
    expect(args[args.indexOf("-s") + 1]).toBe("mt-id1");
    expect(args[args.indexOf("-c") + 1]).toBe("/proj");
  });
  it("passes the program + its args after `--` (so flags aren't parsed by tmux)", () => {
    const dashdash = args.indexOf("--");
    expect(dashdash).toBeGreaterThan(0);
    expect(args.slice(dashdash + 1)).toEqual(["/bin/zsh", "-lc", "exec codex"]);
  });
});

describe("TMUX_CONF_LINES", () => {
  // Regression: without `mouse on`, tmux's default alternate-scroll turns the wheel into
  // ↑/↓ arrows inside claude — cycling input history instead of scrolling the terminal.
  it("enables mouse so the wheel scrolls the program instead of cycling history", () => {
    expect(TMUX_CONF_LINES).toContain("set -g mouse on");
  });

  // Regression: tmux swallows a program's OSC 52 unless set-clipboard is on AND the outer
  // terminal is known to support it (the Ms override) — else Claude's auto-copy (#206)
  // never reaches the browser clipboard inside grid terminals.
  it("forwards OSC 52 to the outer terminal (Claude's auto-copy → browser clipboard)", () => {
    expect(TMUX_CONF_LINES).toContain("set -g set-clipboard on");
    expect(TMUX_CONF_LINES.some((l) => l.includes("terminal-overrides") && l.includes("Ms="))).toBe(true);
  });
});

describe("isResumableTmuxSession", () => {
  const none = () => false;
  const empty = new Set<string>();

  it("keeps a session that is live, a grid session, or has a Claude/Codex transcript", () => {
    expect(isResumableTmuxSession("a", new Set(["a"]), empty, empty, none)).toBe(true); // live pty
    expect(isResumableTmuxSession("b", empty, new Set(["b"]), empty, none)).toBe(true); // persisted grid session
    expect(isResumableTmuxSession("c", empty, empty, new Set(["c"]), none)).toBe(true); // Claude transcript on disk
    expect(isResumableTmuxSession("d", empty, empty, empty, (id) => id === "d")).toBe(true); // Codex rollout on disk
  });

  it("treats a session tracked nowhere as a pure orphan (reap-able)", () => {
    expect(isResumableTmuxSession("z", new Set(["a"]), new Set(["b"]), new Set(["c"]), (id) => id === "d")).toBe(false);
  });
});
