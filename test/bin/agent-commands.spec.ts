// @vitest-environment node
//
// The launcher's agent table (#2082), and the pin that keeps it honest.
//
// `bin/` runs as plain JS before tsx exists, so it CANNOT import `TERMINAL_AGENTS` or the adapters
// — the same constraint that makes `isWslHost()` mirror `server/files/wsl.ts`. A mirrored list
// nobody checks is how an eighth agent silently stops counting toward "is anything installed", so
// the table is pinned here against both of the things it mirrors.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AGENT_COMMANDS, agentBin, canRun, installedAgents, isPlainCommandName, namesAPath } from "../../bin/agent-commands.js";
import { TERMINAL_AGENTS } from "../../common/sessionAgent.js";
import { claudeAdapter } from "../../server/agents/claude.js";
import { codexAdapter } from "../../server/agents/codex.js";
import { antigravityAdapter } from "../../server/agents/antigravity.js";
import { grokAdapter } from "../../server/agents/grok.js";
import { museAdapter } from "../../server/agents/muse.js";
import { copilotAdapter } from "../../server/agents/copilot.js";
import { cursorAdapter } from "../../server/agents/cursor.js";

const ADAPTERS = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
  grok: grokAdapter,
  muse: museAdapter,
  copilot: copilotAdapter,
  cursor: cursorAdapter,
};

// `bin()` reads `<AGENT>_BIN` live, so the DEFAULT command is only observable with the overrides
// gone — and the machine this runs on really does set CLAUDE_BIN.
beforeEach(() => AGENT_COMMANDS.forEach(({ env }) => vi.stubEnv(env, undefined)));
afterEach(() => vi.unstubAllEnvs());

describe("the launcher's agent table mirrors the server's", () => {
  it("names exactly the agents a terminal can be launched as", () => {
    expect([...AGENT_COMMANDS.map(({ agent }) => agent)].sort()).toEqual([...TERMINAL_AGENTS].sort());
  });

  // Not the same assertion as the one above: a table could hold every agent and still look for the
  // wrong binary, which is a startup refusal with no error anywhere near the cause.
  it.each(TERMINAL_AGENTS)("looks for the same command and override the %s adapter runs", (agent) => {
    const row = AGENT_COMMANDS.find((candidate) => candidate.agent === agent);
    expect(row).toBeDefined();
    expect(row?.cmd).toBe(ADAPTERS[agent].bin());
    expect(row?.env).toBe(ADAPTERS[agent].binEnvVar);
  });

  it("gives every agent something to type to install it", () => {
    AGENT_COMMANDS.forEach(({ agent, hint }) => expect(hint, agent).not.toBe(""));
  });
});

describe("agentBin", () => {
  // Not `find(...)!`: if the table ever loses this row the failure should name THAT, not be a
  // non-null assertion quietly passing an undefined into the function under test.
  const claude = AGENT_COMMANDS.find(({ agent }) => agent === "claude") ?? { agent: "claude", cmd: "MISSING FROM AGENT_COMMANDS", env: "CLAUDE_BIN", hint: "" };

  it("uses the default command when nothing overrides it", () => {
    expect(agentBin(claude, {})).toBe("claude");
  });

  // THE BUG IN #2082. The gate asked PATH for the literal name `claude`, while the server runs
  // `CLAUDE_BIN`. A user whose Claude Code lives outside PATH was refused startup and told to
  // install what they already had.
  it("uses <AGENT>_BIN when it is set, which is what the server will run", () => {
    expect(agentBin(claude, { CLAUDE_BIN: "/opt/homebrew/bin/claude" })).toBe("/opt/homebrew/bin/claude");
  });

  // An override set to the empty string is not an override — it is an unset variable spelled badly,
  // and resolving to "" would ask the probe about nothing at all.
  it("falls back to the default command for an empty override", () => {
    expect(agentBin(claude, { CLAUDE_BIN: "" })).toBe("claude");
  });
});

describe("installedAgents", () => {
  const probeFor =
    (...bins: string[]) =>
    (bin: string) =>
      bins.includes(bin);

  it("answers only the agents whose command this machine can run", () => {
    expect(installedAgents({}, probeFor("codex")).map(({ agent }) => agent)).toEqual(["codex"]);
  });

  it("answers nothing when no agent is installed, which is what the gate refuses on", () => {
    expect(installedAgents({}, probeFor())).toEqual([]);
  });

  it("asks about the overridden path rather than the bare name", () => {
    const env = { CLAUDE_BIN: "/opt/bin/claude" };
    expect(installedAgents(env, probeFor("/opt/bin/claude")).map(({ agent }) => agent)).toEqual(["claude"]);
    expect(installedAgents(env, probeFor("claude"))).toEqual([]);
  });

  it("answers every installed agent, not the first", () => {
    expect(installedAgents({}, probeFor("claude", "codex", "cursor-agent")).map(({ agent }) => agent)).toEqual(["claude", "codex", "cursor"]);
  });
});

// The launcher must answer "can this be started" the SAME WAY the server does, and it did not:
// `hasCommand` builds a shell string, so a `<AGENT>_BIN` with a space in it was split at the space
// and reported missing — the app refusing to start for someone who HAS the agent, which is the
// complaint #2082 exists to fix, re-created through a different door. The server answers `true` for
// that same path (measured), so the two disagreed in the one direction that matters.
describe("canRun — the launcher agreeing with the server", () => {
  const SPACED = "/Applications/My Tools/claude";
  const probe = (opts: { isFile?: boolean; isExecutable?: boolean; runsOnPath?: boolean } = {}) => ({
    isFile: () => opts.isFile ?? false,
    isExecutable: () => opts.isExecutable ?? false,
    runsOnPath: () => opts.runsOnPath ?? false,
  });

  it("asks the FILESYSTEM about a path, so a space in it is not a word boundary", () => {
    expect(canRun(SPACED, probe({ isFile: true, isExecutable: true }), "darwin")).toBe(true);
  });

  // The shell is what a bare NAME still needs: `npm install -g` on Windows produces `codex.cmd`,
  // which CreateProcess cannot run without one.
  it("asks PATH about a bare name, by running it", () => {
    expect(canRun("codex", probe({ runsOnPath: true }), "darwin")).toBe(true);
    expect(canRun("codex", probe({ isFile: true, isExecutable: true }), "darwin")).toBe(false);
  });

  it("does not count a path that is not a file", () => {
    expect(canRun(SPACED, probe({ isExecutable: true }), "darwin")).toBe(false);
  });

  // Mirrors `diagnosePathName`: on POSIX a file that exists but cannot be run is not an agent, and
  // saying so is the difference between "install it" and "chmod +x it".
  it("requires the execute bit on POSIX", () => {
    expect(canRun(SPACED, probe({ isFile: true }), "linux")).toBe(false);
  });

  // ...and must NOT require it on Windows, which has no such bit — executability there is the
  // extension. Asking for it would refuse every Windows install.
  it("does not require the execute bit on Windows", () => {
    expect(canRun("C:\\Program Files\\claude\\claude.exe", probe({ isFile: true }), "win32")).toBe(true);
  });
});

describe("namesAPath", () => {
  it.each(["/opt/bin/claude", "./claude", "C:\\tools\\claude.exe", "dir/claude"])("%s names a path", (bin) => {
    expect(namesAPath(bin)).toBe(true);
  });

  it.each(["claude", "cursor-agent", "agy"])("%s is a bare name", (bin) => {
    expect(namesAPath(bin)).toBe(false);
  });
});

// Codex review, round 1. Both were reproduced before being accepted.
describe("canRun — the two ways the launcher disagreed with the server", () => {
  // A RELATIVE path resolves against the PTY's cwd, not this process's, so it cannot be answered
  // from here — `diagnosePathName` returns ok for exactly that reason. Probing it from the
  // launcher's cwd made the launcher refuse `CLAUDE_BIN=./claude` that the server treats as
  // spawnable; measured server=true / launcher=false for all three of these before the fix.
  it.each(["./claude", "dir/claude", "../bin/claude"])("does not refuse the relative path %s the server accepts", (bin) => {
    expect(canRun(bin, { isFile: () => false, isExecutable: () => false, runsOnPath: () => false }, "linux")).toBe(true);
  });

  it("still probes an ABSOLUTE path, which is the one the filesystem can answer", () => {
    expect(canRun("/opt/bin/claude", { isFile: () => false, isExecutable: () => false, runsOnPath: () => true }, "linux")).toBe(false);
  });

  it("treats a Windows drive path as absolute rather than relative", () => {
    expect(canRun("C:\\tools\\claude.exe", { isFile: () => false, isExecutable: () => false, runsOnPath: () => true }, "win32")).toBe(false);
  });

  // The PATH probe runs `<name> --version` THROUGH A SHELL, and a bare name from `<AGENT>_BIN`
  // reaches it. Measured: `CODEX_BIN='echo hi; touch /tmp/x'` ran the touch. Not a privilege
  // boundary — the variable is the user's own environment, and a repo-local `.env` reaches the
  // SERVER child rather than this process — but a value that cannot be a command name must be
  // reported MISSING, not executed as a command line.
  it.each(["echo hi; touch /tmp/x", "claude && rm -rf /", "$(id)", "`id`", "my codex", "claude|tee", "a>b"])(
    "refuses %p without ever asking the shell",
    (bin) => {
      let asked = false;
      const probe = { isFile: () => false, isExecutable: () => false, runsOnPath: () => ((asked = true), true) };
      expect(canRun(bin, probe, "linux")).toBe(false);
      expect(asked, "the shell probe must not be reached").toBe(false);
    },
  );

  it("still accepts the command names agents really have", () => {
    const probe = { isFile: () => false, isExecutable: () => false, runsOnPath: () => true };
    ["claude", "codex", "cursor-agent", "agy", "claude.cmd", "copilot.exe"].forEach((bin) => expect(canRun(bin, probe, "win32"), bin).toBe(true));
  });
});

describe("isPlainCommandName", () => {
  it.each(["claude", "cursor-agent", "claude.cmd", "node_18", "a+b", "user@host"])("%s is a command name", (bin) => {
    expect(isPlainCommandName(bin)).toBe(true);
  });

  it.each(["", "my codex", "a;b", "a|b", "a&b", "$(x)", "`x`", "a>b", "a<b", "a\nb"])("%p is not", (bin) => {
    expect(isPlainCommandName(bin)).toBe(false);
  });
});
