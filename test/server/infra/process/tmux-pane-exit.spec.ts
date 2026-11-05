// @vitest-environment node
//
// How an agent's pane ended, read back from tmux (#3272). The parser is checked against inputs in
// both directions, and the hook itself against a REAL tmux on a throwaway `-S` server with `$TMUX`
// removed, so the live `-L mulmoterminal` server is never reached. That half is skipped where there
// is no tmux: what it pins is tmux's own behaviour, which no fake could stand in for.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PANE_EXIT_DIR_SEGMENTS, paneExitRecordingArgs, parsePaneExitRecord } from "../../../../server/infra/process/tmux-pane-exit";
import { spawnCapture } from "../../../../server/infra/process/spawnCapture";

const SIGNALS: ReadonlyMap<string, number> = new Map(Object.entries(os.constants.signals));
const hasTmux = process.platform !== "win32" && spawnCapture("tmux", ["-V"]).status === 0;

describe("parsePaneExitRecord", () => {
  it.each([
    ["0:", 0],
    ["1:", 1],
    ["127:", 127],
    ["3:\n", 3],
    ["  2:  ", 2],
  ])("reads a status %j as itself", (record, code) => {
    expect(parsePaneExitRecord(record, SIGNALS)).toBe(code);
  });

  // tmux 3.6a on macOS writes the name, 3.4 on Ubuntu the number. A name maps through the HOST's
  // table, whose numbers differ (SIGABRT is 22 on Windows), so the expectation is read from it too.
  const signalCode = (name: string) => 128 + (SIGNALS.get(name) ?? Number.NaN);
  it.each([
    [":kill", signalCode("SIGKILL")],
    [":segv", signalCode("SIGSEGV")],
    [":abrt", signalCode("SIGABRT")],
    [":KILL", signalCode("SIGKILL")],
    [":9", 128 + 9],
    [":11", 128 + 11],
  ])("reads a signal %j as 128 + its number", (record, code) => {
    expect(parsePaneExitRecord(record, SIGNALS)).toBe(code);
  });

  it("prefers the status when both are present", () => {
    expect(parsePaneExitRecord("4:kill", SIGNALS)).toBe(4);
  });

  it.each(["", ":", " ", "0", "kill", ":nosuchsignal", "a:", "-1:", "1:2:3", "1;kill", ":ki ll", "#{pane_dead_status}:"])(
    "says nothing for a record it cannot read (%j)",
    (record) => {
      expect(parsePaneExitRecord(record, SIGNALS)).toBeNull();
    },
  );

  it("says nothing for a signal name the host does not know", () => {
    expect(parsePaneExitRecord(":kill", new Map())).toBeNull();
  });
});

describe("paneExitRecordingArgs", () => {
  const args = paneExitRecordingArgs("mt-abc");

  // Each `;` must be its OWN argument: that is what tmux splits a command list on in argv.
  it("chains two commands onto whatever precedes it, the hook first", () => {
    expect(args[0]).toBe(";");
    expect(args.filter((arg) => arg === ";")).toHaveLength(2);
    expect(args.slice(1, 3)).toEqual(["set-hook", "pane-died"]);
    expect(args.slice(-4)).toEqual(["set-option", "-w", "remain-on-exit", "on"]);
  });

  it("writes the record under the server's own HOME and then kills the pane", () => {
    const hook = args[3] ?? "";
    expect(hook).toContain(`"$HOME/${PANE_EXIT_DIR_SEGMENTS.join("/")}"/mt-abc`);
    expect(hook).toContain("exit 0");
    expect(hook.endsWith("; kill-pane")).toBe(true);
  });
});

describe.skipIf(!hasTmux)("the recording against a real tmux", () => {
  const POLL_MS = 50;
  // Generous: a loaded CI runner once outran a shorter wait, which tmux 3.4 never did locally.
  const POLL_LIMIT = 200;
  let dir = "";
  let socket = "";
  // HOME is the throwaway directory, so the hook's `"$HOME/…"` lands there and nowhere real.
  const env = () => ({ ...process.env, TMUX: undefined, HOME: dir });
  const tmux = (args: string[]) => spawnCapture("tmux", ["-S", socket, "-f", "/dev/null", ...args], { env: env() });
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const start = (name: string, script: string) => tmux(["new-session", "-d", "-s", name, "--", "sh", "-c", script, ...paneExitRecordingArgs(name)]);
  const sessionAlive = (name: string) => tmux(["has-session", "-t", `=${name}`]).status === 0;
  const recordFile = (name: string) => path.join(dir, ...PANE_EXIT_DIR_SEGMENTS, name);
  const recorded = (name: string) => (existsSync(recordFile(name)) ? readFileSync(recordFile(name), "utf8") : "");

  // "" once the session is gone; otherwise what tmux says about it, so a session left behind (a dead
  // pane nobody killed is the failure that matters) reads as such in the assertion.
  const untilEnded = async (name: string): Promise<string> => {
    for (let i = 0; i < POLL_LIMIT; i += 1) {
      if (!sessionAlive(name)) return "";
      await sleep(POLL_MS);
    }
    const panes = tmux(["list-panes", "-t", `=${name}:`, "-F", "dead=#{pane_dead} status=#{pane_dead_status} cmd=#{pane_current_command}"]).stdout.trim();
    const facts = [
      `still alive: ${panes} record=${JSON.stringify(recorded(name))}`,
      `version: ${spawnCapture("tmux", ["-V"]).stdout.trim()}`,
      `hooks: ${tmux(["show-hooks", "-t", `=${name}`]).stdout.trim()} | global: ${tmux(["show-hooks", "-g", "pane-died"]).stdout.trim()}`,
      `messages: ${tmux(["show-messages"]).stdout.trim()}`,
      `jobs: ${spawnCapture("ps", ["-eo", "pid,stat,args"])
        .stdout.split("\n")
        .filter((line) => line.includes("pane-exits"))
        .join(" / ")}`,
    ];
    return facts.join("\n");
  };

  beforeAll(() => {
    // Short on purpose: a unix socket path past ~104 bytes cannot be bound, and os.tmpdir() alone
    // is already long on macOS.
    dir = mkdtempSync(path.join(os.tmpdir(), "mt-x-"));
    socket = path.join(dir, "s");
  });

  afterAll(() => {
    tmux(["kill-server"]);
    rmSync(dir, { recursive: true, force: true });
  });

  // First and alone on purpose: when the crashed session is the server's LAST, the server exits with
  // it, so a record held in tmux itself would be gone before anyone read it.
  it("survives the server exiting with its last session", async () => {
    expect(start("alone", "sleep 0.3; kill -9 $$").status).toBe(0);
    expect(await untilEnded("alone")).toBe("");
    expect(tmux(["ls"]).status).not.toBe(0);
    expect(parsePaneExitRecord(recorded("alone"), SIGNALS)).toBe(128 + 9);
  });

  describe("beside another session", () => {
    beforeAll(() => {
      tmux(["new-session", "-d", "-s", "bystander", "sleep 60"]);
    });

    it.each([
      ["exits-0", "sleep 0.3; exit 0", 0],
      ["exits-3", "sleep 0.3; exit 3", 3],
      ["killed", "sleep 0.3; kill -9 $$", 128 + 9],
      ["segv", "sleep 0.3; kill -SEGV $$", 128 + 11],
    ])("records %s and still ends the session", async (name, script, code) => {
      expect(start(name, script).status).toBe(0);
      expect(await untilEnded(name)).toBe("");
      expect(parsePaneExitRecord(recorded(name), SIGNALS)).toBe(code);
    });

    // A program can die before the chained commands run. Whatever got recorded, the pane must not
    // be left dead on screen with the session still alive.
    it("never leaves a session behind for a program that dies at once", async () => {
      expect(start("instant", "exit 7").status).toBe(0);
      expect(await untilEnded("instant")).toBe("");
      expect([null, 7]).toContain(parsePaneExitRecord(recorded("instant"), SIGNALS));
    });

    // Per session: a session started without it must keep tmux's defaults, so a shell cell neither
    // leaves a dead pane behind nor records anything.
    it("leaves every other session as it was", () => {
      expect(tmux(["show-options", "-w", "-v", "-t", "=bystander:", "remain-on-exit"]).stdout.trim()).toBe("");
      expect(tmux(["show-options", "-g", "-w", "-v", "remain-on-exit"]).stdout.trim()).toBe("off");
      expect(tmux(["show-hooks", "-g"]).stdout).not.toContain("run-shell");
      expect(recorded("bystander")).toBe("");
    });
  });
});
