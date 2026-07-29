import { describe, it, expect } from "vitest";
import {
  tmuxSessionName,
  tmuxNewSessionArgs,
  TMUX_CONF_LINES,
  isResumableTmuxSession,
  parseTmuxEnvironment,
  parseAttachedClientCount,
  parseTmuxTerminalModes,
  planMsOverride,
  MS_OVERRIDE_ENTRY,
} from "../../../server/infra/tmux";

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

  it("passes no -e when there is no per-session environment", () => {
    expect(args).not.toContain("-e");
  });

  // A pane takes the tmux SERVER's environment, which outlives any one session — so a
  // per-session value has to be set ON the session with -e, never exported into our own env.
  describe("with a per-session environment", () => {
    const withEnv = tmuxNewSessionArgs("id1", "/bin/zsh", ["-lc", "exec claude"], "/proj", { MULMOTERMINAL_PORT: "34567", MULMOTERMINAL_SESSION_ID: "abc" });

    it("sets each variable with -e KEY=VALUE", () => {
      expect(withEnv).toContain("-e");
      expect(withEnv).toContain("MULMOTERMINAL_PORT=34567");
      expect(withEnv).toContain("MULMOTERMINAL_SESSION_ID=abc");
    });

    // After `--` they would be arguments to the program, not tmux flags.
    it("keeps them before `--`, and the program after it", () => {
      const dashdash = withEnv.indexOf("--");
      expect(withEnv.indexOf("MULMOTERMINAL_PORT=34567")).toBeLessThan(dashdash);
      expect(withEnv.slice(dashdash + 1)).toEqual(["/bin/zsh", "-lc", "exec claude"]);
    });
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

  // #978: tmux's copy-mode wheel default is `send -X -N 5 scroll-up` — a plain shell pane has no
  // mouse mode, so the wheel enters copy-mode and the scrollback moved five lines at a time,
  // which reads as a jerky paragraph-sized jump. One line per report is the smooth end of it; the
  // client's TRACKPAD_GAIN is calibrated against this number, so the two change together.
  it("scrolls copy-mode one line per wheel report, not tmux's default five", () => {
    ["copy-mode", "copy-mode-vi"].forEach((table) => {
      expect(TMUX_CONF_LINES).toContain(`bind -T ${table} WheelUpPane select-pane \\; send -X -N 1 scroll-up`);
      expect(TMUX_CONF_LINES).toContain(`bind -T ${table} WheelDownPane select-pane \\; send -X -N 1 scroll-down`);
    });
  });

  // `send -X` acts on the ACTIVE pane, so tmux's own default selects the pane under the pointer
  // first. Dropping that (the tempting way to write "just change the 5 to a 1") scrolls the
  // focused pane while the pointer is over another split — a worse bug than the one being fixed.
  it("keeps tmux's pane selection, so a split under the pointer is the one that scrolls", () => {
    TMUX_CONF_LINES.filter((l) => l.includes("Wheel")).forEach((line) => {
      expect(line).toContain("select-pane \\;");
    });
  });

  // In a conf FILE the separator must be escaped: a bare `;` ends the bind-key, leaving the key
  // bound to `select-pane` alone and running the scroll once at startup.
  it("escapes the command separator so the bind carries both commands", () => {
    TMUX_CONF_LINES.filter((l) => l.includes("Wheel")).forEach((line) => {
      expect(line).not.toMatch(/[^\\];/);
    });
  });

  // Both tables, because which one is live follows `mode-keys`, which tmux derives from $EDITOR:
  // binding only `copy-mode` leaves anyone with a vi-ish EDITOR on the five-line jump.
  it("binds both copy-mode tables, since mode-keys decides which is live", () => {
    expect(TMUX_CONF_LINES.filter((l) => l.includes("WheelUpPane"))).toHaveLength(2);
  });

  // #783: tmux strips OSC 8 hyperlinks (Claude's statusline `PR #NNNN`) unless told the outer
  // terminal has the `hyperlinks` feature — same shape as the Ms override above.
  it("forwards OSC 8 hyperlinks to the outer terminal", () => {
    expect(TMUX_CONF_LINES.some((l) => l.includes("terminal-features") && l.includes("hyperlinks"))).toBe(true);
  });

  // Regression (#740): with DOUBLE quotes tmux escape-processes the value while parsing the
  // conf — `\E` becomes a bare `E` and `\007` a raw BEL — so the stored capability emits
  // `E]52;…` as literal text and the clipboard write never happens. Measured on tmux 3.6a.
  it("single-quotes the Ms override so tmux stores `\\E` rather than eating it", () => {
    const line = TMUX_CONF_LINES.find((l) => l.includes("Ms="));
    expect(line).toBe(`set -ag terminal-overrides ',${MS_OVERRIDE_ENTRY}'`);
    expect(line).not.toContain('"');
    expect(MS_OVERRIDE_ENTRY).toContain("Ms=\\E]52;");
  });
});

describe("planMsOverride", () => {
  // Captured from a real `tmux -L … show -g terminal-overrides` on tmux 3.6a. tmux doubles
  // each stored backslash on the way out, so a working entry reads `Ms=\\E]52;`.
  const DEFAULT_ONLY = "terminal-overrides[0] linux*:AX@\n";
  const WORKING = `${DEFAULT_ONLY}terminal-overrides[1] "*:Ms=\\\\E]52;%p1%s;%p2%s\\\\007"\n`;
  const BROKEN = `${DEFAULT_ONLY}terminal-overrides[1] "*:Ms=E]52;%p1%s;%p2%s\\a"\n`;

  it("appends when the server has no OSC 52 override yet", () => {
    expect(planMsOverride(DEFAULT_ONLY)).toEqual({ kind: "append" });
    expect(planMsOverride("")).toEqual({ kind: "append" });
  });

  it("leaves a correctly-stored override alone", () => {
    expect(planMsOverride(WORKING)).toEqual({ kind: "ok" });
  });

  // A server started before #740 keeps the broken value for its whole life — rewriting that
  // one index is the only way an upgrade reaches it.
  it("rewrites the entry a pre-fix server stored with the escape eaten", () => {
    expect(planMsOverride(BROKEN)).toEqual({ kind: "replace", index: 1 });
  });

  it("ignores overrides that are not ours", () => {
    expect(planMsOverride("terminal-overrides[0] xterm*:XT\nterminal-overrides[1] screen*:Ms@\n")).toEqual({ kind: "append" });
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

describe("parseTmuxEnvironment", () => {
  it("reads plain NAME=value lines", () => {
    const env = parseTmuxEnvironment("HOME=/Users/u\nPATH=/usr/bin:/bin\n");
    expect(env.get("HOME")).toBe("/Users/u");
    expect(env.get("PATH")).toBe("/usr/bin:/bin");
    expect(env.size).toBe(2);
  });

  it("omits vars already flagged for removal (rendered as -NAME)", () => {
    const env = parseTmuxEnvironment("-PREFIX\nHOME=/Users/u\n");
    expect(env.has("PREFIX")).toBe(false);
    expect(env.get("HOME")).toBe("/Users/u");
  });

  it("keeps a multi-line value whole instead of reading its lines as new vars", () => {
    const env = parseTmuxEnvironment("SSH_KEY=-----BEGIN-----\nabc\n-----END-----\nHOME=/Users/u\n");
    expect(env.get("SSH_KEY")).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(env.get("HOME")).toBe("/Users/u");
  });

  // Regression: a naive line split read a multi-line value's continuations as
  // variable names, so a line beginning `PATH=` inside an exported bash function
  // would have clobbered the real PATH. A name we can't parse is skipped whole —
  // we only ever act on plainly-named vars, so silence is the safe outcome.
  it("never lets a continuation line inside an unparseable var become a var", () => {
    const env = parseTmuxEnvironment("BASH_FUNC_ls%%=() {\n  PATH=/injected\n}\nPATH=/usr/bin\n");
    expect(env.get("PATH")).toBe("/usr/bin");
    expect([...env.keys()]).toEqual(["PATH"]);
  });

  it("does not let the trailing newline extend the last value", () => {
    expect(parseTmuxEnvironment("PATH=/usr/bin\n").get("PATH")).toBe("/usr/bin");
  });

  it("keeps an empty value, and tolerates empty output", () => {
    expect(parseTmuxEnvironment("EMPTY=\n").get("EMPTY")).toBe("");
    expect(parseTmuxEnvironment("").size).toBe(0);
  });
});

describe("parseAttachedClientCount", () => {
  it("reads the client count", () => {
    expect(parseAttachedClientCount("2\n")).toBe(2);
    expect(parseAttachedClientCount("0")).toBe(0);
  });

  // The caller decides whether to KILL a session, so "we could not tell" has to be
  // distinguishable from "nobody is attached" — null, never 0.
  it("returns null for anything that is not a count", () => {
    expect(parseAttachedClientCount("")).toBeNull();
    expect(parseAttachedClientCount("no server running")).toBeNull();
    expect(parseAttachedClientCount("-1")).toBeNull();
    expect(parseAttachedClientCount("1.5")).toBeNull();
  });
});

// Fields, in order: alternate_on, mouse_standard_flag, mouse_button_flag, mouse_all_flag,
// mouse_utf8_flag, mouse_sgr_flag.
describe("parseTmuxTerminalModes", () => {
  // Measured on a live Claude Code 2.1.220 pane under tmux 3.6a.
  it("reads a mouse TUI's pane as the alternate buffer plus its tracking and SGR modes", () => {
    expect(parseTmuxTerminalModes("1,0,0,1,0,1\n")).toEqual([1049, 1003, 1006]);
  });

  it("reads a plain shell's pane as nothing to restore", () => {
    expect(parseTmuxTerminalModes("0,0,0,0,0,0\n")).toEqual([]);
  });

  it("maps the older tracking flags too", () => {
    expect(parseTmuxTerminalModes("1,1,1,0,1,1")).toEqual([1049, 1000, 1002, 1005, 1006]);
  });

  // A tmux that doesn't know a variable renders it EMPTY. The remaining fields must keep their
  // own modes rather than sliding onto the previous one.
  it("keeps the fields aligned when a variable is unknown to this tmux", () => {
    expect(parseTmuxTerminalModes("1,0,0,,,1")).toEqual([1049, 1006]);
  });

  it("restores nothing from output tmux could not produce", () => {
    expect(parseTmuxTerminalModes("")).toEqual([]);
    expect(parseTmuxTerminalModes("no server running")).toEqual([]);
  });
});
