// Windows-only: the real node-pty spawns that #794 and #798 are about. Skipped everywhere
// else, so this runs in .github/workflows/windows-daily.yaml (which already runs `yarn test`)
// rather than in the PR matrix — the rules themselves are covered by the pure tests in
// infra/resolve-bin.spec and infra/cmd-escape.spec.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pty from "node-pty";
import { spawnPty } from "../../../server/session/pty-spawn";
import { resolvePtyLaunchForEnv } from "../../../server/infra/resolve-bin";
import { hookSettingsJson } from "../../../server/session/hook-settings";
import { buildCodexArgs } from "../../../server/agents/codex-args";

const isWindows = process.platform === "win32";

// A binary that exists ONLY as an .exe, with no extensionless twin — the shape of a Claude
// Code install from the official Windows installer. node.exe stands in for it: it is
// guaranteed present and answers `-e`.
const PROBE = `mt-probe-${process.pid}`;
// A command that exists ONLY as a .cmd — what an npm-global install leaves on PATH.
const SHIM = `mt-shim-${process.pid}`;

const exitCodeOf = (term: pty.IPty): Promise<number> => new Promise((resolve) => term.onExit(({ exitCode }) => resolve(exitCode)));

describe.skipIf(!isWindows)("spawnPty on Windows", () => {
  let dir = "";
  let probeExe = "";
  let shimCmd = "";
  let argsOut = "";
  let originalPath: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-probe-"));
    probeExe = path.join(dir, `${PROBE}.exe`);
    copyFileSync(process.execPath, probeExe);

    // The argv the shim's child actually received, recorded to a file rather than stdout: a
    // conpty wraps and escapes what it prints, which would corrupt the comparison.
    argsOut = path.join(dir, "args.json");
    const echoJs = path.join(dir, "echo-args.js");
    writeFileSync(echoJs, `require("node:fs").writeFileSync(process.env.MT_ARGS_OUT, JSON.stringify(process.argv.slice(2)));\n`);
    // Shaped like npm's generated shim: forward %* to a node script. CRLF, as batch files are.
    shimCmd = path.join(dir, `${SHIM}.cmd`);
    writeFileSync(shimCmd, ["@ECHO off", `"${probeExe}" "${echoJs}" %*`, ""].join("\r\n"));

    originalPath = process.env.PATH;
    process.env.PATH = `${dir};${process.env.PATH ?? ""}`;
    process.env.MT_ARGS_OUT = argsOut;
    process.env.MT_MARKER = "expanded-by-cmd";
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    delete process.env.MT_ARGS_OUT;
    delete process.env.MT_MARKER;
    rmSync(dir, { recursive: true, force: true });
  });

  // Run the .cmd shim through spawnPty and return the argv its child received.
  async function argvThroughShim(args: string[]): Promise<string[]> {
    rmSync(argsOut, { force: true });
    const term = spawnPty(SHIM, args, dir);
    expect(await exitCodeOf(term)).toBe(0);
    return JSON.parse(readFileSync(argsOut, "utf8"));
  }

  it("resolves a bare name to the .exe on PATH", () => {
    expect(resolvePtyLaunchForEnv(PROBE, [], process.env)).toEqual({ file: probeExe, args: [] });
  });

  it("spawns a PTY for a bare name whose only match is an .exe", async () => {
    const term = spawnPty(PROBE, ["-e", "process.stdout.write('mt-probe ok')"], dir);
    expect(term.pid).toBeGreaterThan(0);
    let output = "";
    term.onData((data) => {
      output += data;
    });
    expect(await exitCodeOf(term)).toBe(0);
    expect(output).toContain("mt-probe ok");
  });

  // The reason resolve-bin.ts exists. When this starts failing, node-pty has learned to
  // resolve executable extensions itself (its src/win/path_util.cc get_shell_path) and the
  // workaround can be reconsidered — it is not a sign that anything here regressed.
  it("pins the node-pty bug it works around: a bare name alone still fails", () => {
    let term: pty.IPty;
    try {
      term = pty.spawn(PROBE, [], { name: "xterm-256color", cols: 80, rows: 24, cwd: dir, env: process.env });
    } catch (err) {
      expect(String(err)).toMatch(/File not found/);
      return;
    }
    term.kill();
    expect.fail("node-pty resolved a bare name on its own — re-check whether infra/resolve-bin.ts is still needed");
  });

  it("resolves a .cmd-only command to cmd.exe with a raw command line", () => {
    const launch = resolvePtyLaunchForEnv(SHIM, ["--resume"], process.env);
    expect(launch.file.toLowerCase()).toContain("cmd.exe");
    expect(launch.args).toBe(`/d /s /c ""${shimCmd}" "--resume""`);
  });

  // Everything below is the empirical half of #798: the escaping is only correct if the
  // argv on the far side of cmd.exe AND the shim's own `%*` forwarding is what we passed.
  it.each([
    ["plain arguments", ["--resume", "abc123"]],
    ["whitespace inside one argument", ["fix the login bug"]],
    ["cmd metacharacters that would otherwise split the command", ["a&b", "c|d", "e>f", "g^h", "(i)"]],
    ["embedded quotes", ['say "hi"']],
    ["a JSON payload, the shape of --settings / --mcp-config", ['{"hooks":{"Stop":[{"command":"curl -s http://127.0.0.1:34567/api/hook"}]}}']],
    ["a path ending in a backslash", ["C:\\Users\\u\\projects\\"]],
    ["non-ASCII", ["ログインの不具合", "修正して"]],
    ["a percent sign with no variable behind it", ["50% done"]],
  ])("round-trips %s through the .cmd shim", async (_case, args) => {
    expect(await argvThroughShim(args)).toEqual(args);
  });

  // The CLAUDE_BIN workaround from #794, applied to an npm-global install: an absolute path
  // skips the PATH search, and a batch file still cannot be handed to CreateProcess.
  it("runs an explicit absolute .cmd path", async () => {
    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(shimCmd, ["--explicit"], dir))).toBe(0);
    expect(JSON.parse(readFileSync(argsOut, "utf8"))).toEqual(["--explicit"]);
  });

  // Pinned, not fixed: cmd expands %VAR% inside double quotes and has no escape for it. See
  // cmd-escape.ts — rejecting every argument containing a percent sign would break ordinary
  // prompts, and substituting our own child's environment into its own argument is a
  // correctness wart rather than a privilege boundary.
  it("expands %VAR% inside an argument — the known limitation of the cmd.exe path", async () => {
    expect(await argvThroughShim(["%MT_MARKER%"])).toEqual(["expanded-by-cmd"]);
  });

  // #813: the real thing. The cases above use a shim of our own shape and payloads we chose;
  // a user on npm-installed Claude Code reported the `--settings` JSON arriving with almost
  // every quote gone, through exactly this path. So: npm's OWN generated shim (cmd-shim's
  // template, whose last line is a compound `endLocal & goto … || title … & "%_prog%" … %*`)
  // carrying the ACTUAL hookSettingsJson payload — 1.6 kB with embedded single quotes, `@`,
  // `>` and `&` inside JSON string values.
  it("round-trips the real --settings payload through npm's own generated shim", async () => {
    const npmShim = `mt-npmshim-${process.pid}`;
    const echoJs = path.join(dir, "echo-args.js");
    writeFileSync(
      path.join(dir, `${npmShim}.cmd`),
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        `SET "_prog=${probeExe}"`,
        "",
        `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "${probeExe}"  "${echoJs}" %*`,
        "",
      ].join("\r\n"),
    );

    const settings = hookSettingsJson({ host: "127.0.0.1", port: 34567, sessionId: "11111111-2222-3333-4444-555555555555" });
    const args = ["--session-id", "11111111-2222-3333-4444-555555555555", "--settings", settings, "--permission-mode", "auto"];

    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(npmShim, args, dir))).toBe(0);
    const received: string[] = JSON.parse(readFileSync(argsOut, "utf8"));
    expect(received).toEqual(args);
    // Said explicitly, because this is the reported symptom: the JSON must still parse.
    expect(() => JSON.parse(received[3])).not.toThrow();
  });

  // #813 again, and the reason the case above was misleading: it reads the child's PARSED
  // argv, and node is the most forgiving argv parser on Windows — it implements the MSVC
  // extension where `""` inside a quoted argument means one literal quote. The real target
  // (`claude.exe`, a native binary) does not, and drops them. So assert what cmd.exe actually
  // DELIVERS, which is the thing this code is responsible for; how the far end parses it is
  // the far end's contract, and the reason the JSON now travels as a file at all.
  //
  // The shim here is cmd-shim's NON-shebang branch — what npm generates for a package whose
  // bin is a native .exe, which is what Claude Code ships. It differs from the compound form
  // above, and the point of having both is that the shim shape does not matter: both hand
  // `%*` on unchanged.
  it("delivers our escaping to the shim intact, whatever the shim shape", async () => {
    const rawShim = `mt-rawshim-${process.pid}`;
    const rawOut = path.join(dir, "raw.txt");
    writeFileSync(
      path.join(dir, `${rawShim}.cmd`),
      ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", `>"${rawOut}" ECHO %*`, ""].join("\r\n"),
    );

    rmSync(rawOut, { force: true });
    const settings = hookSettingsJson({ host: "127.0.0.1", port: 34567, sessionId: "11111111-2222-3333-4444-555555555555" });
    expect(await exitCodeOf(spawnPty(rawShim, ["--settings", settings], dir))).toBe(0);

    const raw = readFileSync(rawOut, "utf8");
    // Our own escaping, unaltered: cmd.exe passed the command line through rather than
    // rewriting it. If this ever fails, cmd IS the corrupting layer and cmd-escape.ts is wrong.
    expect(raw).toContain('""hooks""');
    expect(raw).toContain("-d @- >/dev/null 2>&1");
    expect(raw.trim().startsWith('"--settings"')).toBe(true);
  });

  // The OTHER agent's argv, which nobody had looked at on Windows. buildCodexArgs embeds
  // double quotes on purpose — `-c key="value"` is parsed as TOML, so the quotes are part of
  // the value's syntax — and its comment said "no shell is involved, so the URL needs no
  // escaping". That stopped being true when a `.cmd`-installed codex started going through
  // cmd.exe (#801): lose those quotes and the TOML value is no longer a string.
  it("round-trips codex's quoted TOML overrides through a .cmd shim", async () => {
    const args = buildCodexArgs({
      resume: null,
      model: "gpt-5",
      guiMcpServers: [{ id: "mulmoterminal-gui", url: "http://127.0.0.1:34567/api/mcp/abc-123", autoApprove: true }],
    });
    expect(args.some((a) => a.includes('"'))).toBe(true); // the case only exists while they are quoted

    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(SHIM, args, dir))).toBe(0);
    expect(JSON.parse(readFileSync(argsOut, "utf8"))).toEqual(args);
  });

  // Everything awkward a real argument can hold, in ONE spawn: the comparison is the whole
  // argv array, so a single case that is dropped, split, merged or re-ordered shows up. A
  // Run command and a chat prompt are user text, so this is not a hypothetical set.
  //
  // `%VAR%` is deliberately absent — cmd expands it and has no escape for it inside quotes,
  // which is pinned on its own below. `!VAR!` IS here: delayed expansion is off by default
  // (and `/d` does not turn it off), so this records the default and would flag a machine
  // where it is on.
  it("round-trips awkward argument content", async () => {
    const args = [
      "plain",
      "two words",
      "trailing space ",
      " leading space",
      "tab\there",
      'say "hi"',
      'nested ""double""',
      "single 'quoted'",
      "caret^and^more",
      "parens (a) [b] {c}",
      "amp&pipe|redir>lt<",
      "semi;comma,equals=",
      "bang!not!expanded",
      "dollar$and`backtick",
      "back\\slash\\\\double",
      "path\\ending\\",
      "日本語とCJK",
      "emoji 📎 and 🎉",
      "combining é and ñ",
      'mixed 日本語 with "quotes" and &amp',
    ];

    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(SHIM, args, dir))).toBe(0);
    expect(JSON.parse(readFileSync(argsOut, "utf8"))).toEqual(args);
  });

  // An empty argument has to stay a POSITION, not vanish — an argv that silently loses one
  // shifts every flag after it onto the wrong value.
  it("keeps an empty argument as an argument", async () => {
    const args = ["--before", "", "--after"];
    rmSync(argsOut, { force: true });
    expect(await exitCodeOf(spawnPty(SHIM, args, dir))).toBe(0);
    expect(JSON.parse(readFileSync(argsOut, "utf8"))).toEqual(args);
  });

  // cmd.exe is an extra process between us and the shim, so a non-zero exit has one more
  // layer to survive than it did before #798.
  it("propagates a failing shim's exit code through the cmd.exe layer", async () => {
    const failing = `mt-fail-${process.pid}`;
    writeFileSync(path.join(dir, `${failing}.cmd`), ["@ECHO off", "exit /b 3", ""].join("\r\n"));
    expect(await exitCodeOf(spawnPty(failing, [], dir))).toBe(3);
  });
});
