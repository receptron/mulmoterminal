// @vitest-environment node
//
// The launcher's agent table (#2082), and the pin that keeps it honest.
//
// `bin/` runs as plain JS before tsx exists, so it CANNOT import `TERMINAL_AGENTS` or the adapters
// — the same constraint that makes `isWslHost()` mirror `server/files/wsl.ts`. A mirrored list
// nobody checks is how an eighth agent silently stops counting toward "is anything installed", so
// the table is pinned here against both of the things it mirrors.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AGENT_COMMANDS,
  agentBin,
  canRun,
  firstInstalledAgent,
  installedAgents,
  isPlainCommandName,
  isRunScriptPathEntry,
  namesAPath,
  probeEnvFrom,
  searchPathForProbe,
} from "../../bin/agent-commands.js";
import { isLauncherPathEntry, sanitizePtyEnv } from "../../server/infra/pty-env.js";
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

// Codex review, round 2, reproduced with a real hanging binary before being accepted: a `grok` on
// PATH that blocks for 30 seconds held the startup gate for 30,059 ms even though `claude` had
// already been found and answered the gate's only question.
describe("firstInstalledAgent — the gate's question, not the doctor's", () => {
  it("stops at the first installed agent", () => {
    const asked: string[] = [];
    const found = firstInstalledAgent({}, (bin) => (asked.push(bin), bin === "claude"));
    expect(found?.agent).toBe("claude");
    expect(asked, "nothing after the first hit may be probed").toEqual(["claude"]);
  });

  // The hit is not always first. What matters is that probing STOPS there — the rows after it are
  // commands the user may not control, and one of them hanging must not delay a settled answer.
  it("probes no further than the agent it finds", () => {
    const asked: string[] = [];
    const found = firstInstalledAgent({}, (bin) => (asked.push(bin), bin === "copilot"));
    expect(found?.agent).toBe("copilot");
    expect(asked).toEqual(["claude", "codex", "copilot"]);
    expect(asked).not.toContain("muse");
  });

  it("answers null when nothing is installed, which is what the gate refuses on", () => {
    expect(firstInstalledAgent({}, () => false)).toBeNull();
  });

  it("asks about the overridden path, like the doctor does", () => {
    const found = firstInstalledAgent({ CLAUDE_BIN: "/opt/bin/claude" }, (bin) => bin === "/opt/bin/claude");
    expect(found?.agent).toBe("claude");
  });

  // The doctor still probes EVERY row — it reports each agent's line, so it cannot short-circuit.
  // Its protection against a hang is the probe's own timeout, not this.
  it("is not what the doctor uses: installedAgents still asks about all seven", () => {
    const asked: string[] = [];
    installedAgents({}, (bin) => (asked.push(bin), bin === "claude"));
    expect(asked).toHaveLength(AGENT_COMMANDS.length);
  });
});

// The launcher probes with the PATH the SPAWN will search, and this pins the mirror that makes that
// possible. Codex round 6, reproduced first: `npx mulmoterminal` where a repo's `node_modules/.bin`
// is on PATH — which yarn/npm run-scripts and npx itself arrange — EXECUTED that directory's
// `codex --version` at the gate, a binary `sanitizePtyEnv` exists to keep out of a spawn.
//
// Pinned as an EQUIVALENCE against the server's own predicate rather than by copying its list, so a
// change to either side is a red test rather than a divergence nobody sees. `bin/` cannot import it
// at runtime (plain JS, before tsx) but a spec can.
describe("searchPathForProbe — the launcher looking where the spawn looks", () => {
  const ENTRIES = [
    "/usr/bin",
    "/opt/homebrew/bin",
    "/x/node_modules/.bin",
    "/x/node-gyp-bin",
    "/tmp/yarn--1700000000000-0.1",
    "/home/me/my_node_modules/.bin",
    "/home/me/.bin",
    "/a/node_modules/.bin/deeper",
    "",
    "/",
    "C:\\Windows",
    "D:\\p\\node_modules\\.bin",
    "C:\\Temp\\yarn--1700000000000-0.1",
    "/opt/yarn--not-a-digit",
    // QUOTED, which a Windows PATH entry may be and which `windowsSearchDirectories` strips before
    // looking inside. Matching the quoted spelling kept the very entry the rule removes, and then
    // searched it anyway — the gap was in the SERVER's predicate too, so both were fixed rather
    // than making the launcher stricter (Codex review, round 7).
    '"D:\\p\\node_modules\\.bin"',
    '"C:\\Program Files\\tools"',
    '"/x/node_modules/.bin"',
    '"C:\\Temp\\yarn--1700000000000-0.1"',
    '"unterminated',
    '""',
  ];

  it.each(ENTRIES)("agrees with the server's isLauncherPathEntry about %p", (entry) => {
    expect(isRunScriptPathEntry(entry)).toBe(isLauncherPathEntry(entry));
  });

  // Joined PER DELIMITER: a `:`-joined PATH cannot carry `C:\\Windows`, because it splits at the
  // drive colon. That is the shape of the real thing, not a quirk to design around.
  it.each([
    [":", ENTRIES.filter((entry) => !entry.includes(":"))],
    [";", ENTRIES.filter((entry) => !entry.includes(";"))],
  ])("drops the run-script entries and keeps the rest, in order (%s)", (delimiter, entries) => {
    expect(searchPathForProbe(entries.join(delimiter), delimiter).split(delimiter)).toEqual(entries.filter((entry) => !isLauncherPathEntry(entry)));
  });

  it("answers an empty PATH for an absent one rather than throwing", () => {
    expect(searchPathForProbe(undefined, ":")).toBe("");
  });

  // A user directory that merely CONTAINS one of those names is theirs, which is what matching on
  // the last segment buys and the reason this is not a substring test.
  it("keeps a user directory whose name only resembles one of ours", () => {
    expect(isRunScriptPathEntry("/home/me/my_node_modules/.bin")).toBe(false);
    expect(isRunScriptPathEntry("/a/node_modules/.bin/deeper")).toBe(false);
  });
});

// Found by me while writing round 7's prompt, not by Codex: `{ ...env, PATH: clean }` is wrong on
// WINDOWS, where the variable is `Path`. The spread keeps the original key and the assignment adds a
// SECOND one, so the child can still search the unsanitised value — on the one platform none of this
// can be exercised from here. The server matches the name case-insensitively (`isPathVar`) for
// exactly this reason.
describe("probeEnvFrom — the environment the probe runs in", () => {
  const DIRTY = ["/usr/bin", "/repo/node_modules/.bin"].join(":");
  const CLEAN = "/usr/bin";

  it.each(["PATH", "Path", "path", "PaTh"])("rewrites the %s variable in place rather than adding one", (name) => {
    const out = probeEnvFrom({ [name]: DIRTY, HOME: "/h" }, ":");
    expect(Object.keys(out).sort()).toEqual([name, "HOME"].sort());
    expect(out[name]).toBe(CLEAN);
  });

  it("leaves every other variable exactly as it was", () => {
    const env = { PATH: DIRTY, HOME: "/h", npm_lifecycle_event: "dev", EMPTY: "" };
    const out = probeEnvFrom(env, ":");
    expect({ ...out, PATH: undefined }).toEqual({ ...env, PATH: undefined });
  });

  // The server keeps launcher VARIABLES out of a spawn as well, and this deliberately does not: the
  // probe runs `<agent> --version` in this process's own context, where npm_lifecycle_event and the
  // rest are true of it. Only the PATH decides what is FOUND, and that is what has to agree.
  it("agrees with the server about what a PATH search will find", () => {
    const env = { PATH: DIRTY };
    expect(probeEnvFrom(env, ":").PATH).toBe(sanitizePtyEnv(env, ":").PATH);
  });

  it("answers an env with no PATH at all without inventing one", () => {
    expect(probeEnvFrom({ HOME: "/h" }, ":")).toEqual({ HOME: "/h" });
  });
});
