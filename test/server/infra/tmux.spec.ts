// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  tmuxSessionName,
  tmuxSessionIdsFrom,
  tmuxNewSessionArgs,
  TMUX_CONF_LINES,
  isResumableTmuxSession,
  parseTmuxEnvironment,
  parseAttachedClientCount,
  parseTmuxClientSessions,
  parseTmuxSessionActivity,
  parseTmuxTerminalModes,
  parseTmuxWindowSize,
  redrawTargets,
  planMsOverride,
  MS_OVERRIDE_ENTRY,
  parseTmuxPanePids,
  isScrubbedGlobalEnvEntry,
  tmuxClientUnsetNames,
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

  // Without -u a client that finds no UTF-8 locale name writes one `_` per cell for anything
  // DEC ACS cannot express — Japanese arrives as pairs of underscores (#1634). It is a tmux
  // GLOBAL flag, so it only counts before the command.
  it("forces UTF-8 output with -u, before `new-session`", () => {
    expect(args.indexOf("-u")).toBeGreaterThan(-1);
    expect(args.indexOf("-u")).toBeLessThan(args.indexOf("new-session"));
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

  // Not cosmetic any more: the size check compares `window_height` against the client's, and a
  // status line reserves a row — so with the bar on, every resize would read as a disagreement and
  // nudge the pty for nothing (#957). Measured: with the bar on, `client=80x24` vs `window=80x23`.
  it("turns the status line off, which the window/client size comparison depends on", () => {
    expect(TMUX_CONF_LINES).toContain("set -g status off");
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

// What a running tmux server's global environment must not keep. The server outlives every
// mulmoterminal restart, so a name that got in there once is handed to new panes forever — an
// upgrade alone does not fix it (#451, #989, #1919).
//
// PORT is judged by its VALUE, not by its name: the only one that is ours is the port we are
// listening on, and a cell that inherits it binds the address we are holding (#1857).
describe("isScrubbedGlobalEnvEntry", () => {
  const BOUND = "34601";

  it("scrubs the key we leaked ourselves, and launcher context", () => {
    expect(isScrubbedGlobalEnvEntry("ANTHROPIC_API_KEY", "sk-ant-x", BOUND)).toBe(true);
    ["PREFIX", "npm_config_registry", "INIT_CWD"].forEach((name) => expect(isScrubbedGlobalEnvEntry(name, "x", BOUND), name).toBe(true));
  });

  // NODE_ENV is the deliberate omission (#989): we never read it, so no value under that name is
  // identifiable as ours and taking it would be the bug #955 refused to introduce. MULMOTERMINAL_PORT
  // is how a cell finds this server (#1873) and is set per pane, not globally.
  it("leaves alone what is the user's, and what a session is given on purpose", () => {
    ["NODE_ENV", "MULMOTERMINAL_PORT", "HOME", "PATH", "CLIENT_PORT", "PORTAL"].forEach((name) =>
      expect(isScrubbedGlobalEnvEntry(name, BOUND, BOUND), name).toBe(false),
    );
  });

  it("takes the port we are listening on, whoever put it there", () => {
    expect(isScrubbedGlobalEnvEntry("PORT", BOUND, BOUND)).toBe(true);
  });

  // A tmux server outlives the run that admitted a user's PORT, and the next run may carry no PORT
  // at all. Judging by "is it what WE are carrying" would take the value away on that restart —
  // the cell would lose a setting the direct-PTY path keeps (codex-review iter-2).
  it("keeps a user's PORT across a restart that carries none of its own", () => {
    expect(isScrubbedGlobalEnvEntry("PORT", "3000", BOUND)).toBe(false);
  });

  // The accepted limit, pinned so it is a decision rather than a gap: a leftover naming a port we
  // are not on cannot cost us our address, and nothing tells it from a value the user set.
  it("leaves a stale value that names some other port", () => {
    expect(isScrubbedGlobalEnvEntry("PORT", "34567", BOUND)).toBe(false);
  });
});

// A running server can be scrubbed; one that does not exist yet cannot. `new-session` starts it and
// it keeps the client's environment for life, so our own bind port is dropped from the client too.
describe("tmuxClientUnsetNames", () => {
  it("drops PORT when what we carry IS the port we bind", () => {
    expect([...tmuxClientUnsetNames("34719", "34719")]).toEqual(["PORT"]);
  });

  it("keeps the user's own PORT that --port displaced, and adds nothing when we carry none", () => {
    expect([...tmuxClientUnsetNames("3000", "34601")]).toEqual([]);
    expect([...tmuxClientUnsetNames(undefined, "34567")]).toEqual([]);
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

describe("parseTmuxClientSessions", () => {
  // One line per CLIENT, so the count of a session is how many times its name appears — two
  // mulmoterminal processes on one session is exactly the case this has to see (#1207).
  it("counts the clients on each of our sessions", () => {
    expect(parseTmuxClientSessions("mt-a\nmt-b\nmt-a\n")).toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ]),
    );
  });

  it("ignores sessions that are not ours, and empty output", () => {
    expect(parseTmuxClientSessions("someone-elses\nmt-a\n")).toEqual(new Map([["a", 1]]));
    expect(parseTmuxClientSessions("")).toEqual(new Map());
  });

  // A session with no client does not appear at all, which is what makes "absent" mean zero
  // rather than unknown — the caller can only tell the two apart from the CALL failing.
  it("has no entry for a session nobody holds", () => {
    expect(parseTmuxClientSessions("mt-a\n").has("b")).toBe(false);
  });

  it("survives CRLF", () => {
    expect(parseTmuxClientSessions("mt-a\r\nmt-a\r\n")).toEqual(new Map([["a", 2]]));
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

// Fields: `#{client_pid} #{client_tty}`.
describe("redrawTargets", () => {
  const OUR_PID = 29421;

  it("repaints our own client", () => {
    expect(redrawTargets(`${OUR_PID} /dev/ttys019\n`, OUR_PID)).toEqual(["/dev/ttys019"]);
  });

  // tmux promises nothing about the order of list-clients, so taking the first line would send the
  // repaint to another server's browser and leave this one showing the half-built screen.
  it("picks ours out of a session several clients are attached to, wherever it is listed", () => {
    const listed = `40100 /dev/ttys002\n${OUR_PID} /dev/ttys019\n40200 /dev/ttys044\n`;
    expect(redrawTargets(listed, OUR_PID)).toEqual(["/dev/ttys019"]);
  });

  // Repainting someone else's client is harmless; repainting nobody is the bug itself.
  it("falls back to every client when our pid is not in the list", () => {
    const listed = `40100 /dev/ttys002\n40200 /dev/ttys044\n`;
    expect(redrawTargets(listed, OUR_PID)).toEqual(["/dev/ttys002", "/dev/ttys044"]);
  });

  it("has nothing to repaint when no client is attached", () => {
    expect(redrawTargets("", OUR_PID)).toEqual([]);
    expect(redrawTargets("\n \n", OUR_PID)).toEqual([]);
  });

  it("ignores a line that carries no tty", () => {
    expect(redrawTargets(`${OUR_PID}\n${OUR_PID} /dev/ttys019\n`, OUR_PID)).toEqual(["/dev/ttys019"]);
  });
});

describe("parseTmuxWindowSize", () => {
  it("reads the pair tmux prints", () => {
    expect(parseTmuxWindowSize("120x40\n")).toEqual({ cols: 120, rows: 40 });
  });

  // Every non-answer must read as "don't know", never as a disagreement: the caller RESIZES a
  // live session on a disagreement, and tmux answers with an error line for a session that has
  // gone (#957).
  it("refuses anything that is not a pair of numbers", () => {
    expect(parseTmuxWindowSize("")).toBeNull();
    expect(parseTmuxWindowSize("can't find session: mt-x")).toBeNull();
    expect(parseTmuxWindowSize("120x")).toBeNull();
    expect(parseTmuxWindowSize("x40")).toBeNull();
    expect(parseTmuxWindowSize("120x40x10")).toBeNull();
    expect(parseTmuxWindowSize("-1x40")).toBeNull();
  });
});

// When tmux last saw each session do anything (#1478) — the number that separates "working while I
// was away" from "abandoned three days ago" in the Settings list.
describe("parseTmuxSessionActivity", () => {
  it("reads the epoch second of each of our sessions", () => {
    expect(parseTmuxSessionActivity("mt-a 1700000000\nmt-b 1700000900\n")).toEqual(
      new Map([
        ["a", 1700000000],
        ["b", 1700000900],
      ]),
    );
  });

  it("ignores sessions outside our prefix — the user's own tmux is not ours to list", () => {
    expect(parseTmuxSessionActivity("work 1700000000\nmt-a 1700000001\n")).toEqual(new Map([["a", 1700000001]]));
  });

  // A line tmux gave us without a number, or with something that is not one, must drop out rather
  // than land as NaN and render as an age nobody can read.
  it.each(["mt-a", "mt-a notanumber", ""])("drops the unusable line %j", (line) => {
    expect(parseTmuxSessionActivity(line)).toEqual(new Map());
  });
});

// The pane pid -> session map, which is how a process started BY an agent is traced back to the
// session it belongs to when nothing was handed to it (server/session/bridge-session.ts). The
// FORMAT is the fragile part — it is a tmux format string, and a change to it would silently
// return an empty map, which reads as "no session owns this bridge" and withholds every GUI tool.
describe("parseTmuxPanePids", () => {
  it("keeps only our own sessions, keyed by pane pid", () => {
    const panes = parseTmuxPanePids(["2220 mt-aaaa-1111", "3300 someone-elses-session", "4400 mt-bbbb-2222"].join("\n"));
    expect(panes).toEqual(
      new Map([
        [2220, "aaaa-1111"],
        [4400, "bbbb-2222"],
      ]),
    );
  });

  it("ignores a row it cannot read rather than inventing a pid", () => {
    expect(parseTmuxPanePids(["", "not-a-pid mt-aaaa", "0 mt-bbbb", "-3 mt-cccc", "2220"].join("\n"))).toEqual(new Map());
  });
});

// Three answers, not two: tmux holding nothing and tmux unable to answer are different facts, and
// a caller deciding whether a session still exists must not read the second as the first
// (CodeRabbit, PR #2002).
describe("tmuxSessionIdsFrom", () => {
  it("reads the ids it was given", () => {
    expect(tmuxSessionIdsFrom({ status: 0, stdout: "mt-a\nmt-b\nother\n", stderr: "" })).toEqual(["a", "b"]);
  });

  it("reads an empty list as an empty list", () => {
    expect(tmuxSessionIdsFrom({ status: 0, stdout: "", stderr: "" })).toEqual([]);
  });

  // The ordinary case on a machine with nothing running: tmux exits non-zero and says so.
  it("reads 'no server running' as nothing held", () => {
    expect(tmuxSessionIdsFrom({ status: 1, stdout: "", stderr: "no server running on /tmp/tmux-501/mulmoterminal\n" })).toEqual([]);
  });

  // How a NAMED socket says the same thing: there is no socket file, so there is no server.
  it("reads a missing socket as nothing held", () => {
    const stderr = "error connecting to /tmp/tmux-501/mulmoterminal (No such file or directory)\n";
    expect(tmuxSessionIdsFrom({ status: 1, stdout: "", stderr })).toEqual([]);
  });

  // The binary missing, the socket unreadable, the call timing out (status null) — tmux did not
  // answer, and "nothing held" would be a claim nobody made.
  it("answers null when tmux could not be asked", () => {
    expect(tmuxSessionIdsFrom({ status: 1, stdout: "", stderr: "tmux: unknown option\n" })).toBeNull();
    expect(tmuxSessionIdsFrom({ status: null, stdout: "", stderr: "" })).toBeNull();
    expect(tmuxSessionIdsFrom({ status: 127, stdout: "", stderr: "command not found\n" })).toBeNull();
  });

  // A socket that EXISTS and cannot be read is the indeterminate case, whatever the prefix says.
  // Reading it as empty retires every filed chat on a machine whose tmux is simply not ours to
  // talk to (Codex, PR #2016).
  it("answers null when the socket is there but refuses", () => {
    expect(tmuxSessionIdsFrom({ status: 1, stdout: "", stderr: "error connecting to /tmp/tmux-501/mulmoterminal (Permission denied)\n" })).toBeNull();
    expect(tmuxSessionIdsFrom({ status: 1, stdout: "", stderr: "error connecting to /tmp/tmux-501/mulmoterminal (Connection refused)\n" })).toBeNull();
  });
});
