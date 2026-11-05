// @vitest-environment node
//
// How an agent's pane ended, read back from tmux (#3272). The parser is checked against inputs in
// both directions, and the hook itself against a REAL tmux on a throwaway `-S` server with `$TMUX`
// removed, so the live `-L mulmoterminal` server is never reached. That half is skipped where there
// is no tmux: what it pins is tmux's own behaviour, which no fake could stand in for.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { paneExitOptionName, paneExitRecordingArgs, parsePaneExitRecord } from "../../../../server/infra/process/tmux-pane-exit";
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

  // tmux 3.6a on macOS writes the name; the number form is what the issue measured elsewhere.
  it.each([
    [":kill", 128 + 9],
    [":segv", 128 + 11],
    [":abrt", 128 + 6],
    [":KILL", 128 + 9],
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
  it("chains two commands onto whatever precedes it", () => {
    expect(args[0]).toBe(";");
    expect(args.filter((arg) => arg === ";")).toHaveLength(2);
    expect(args.slice(1, 5)).toEqual(["set-option", "-w", "remain-on-exit", "on"]);
  });

  it("records under the session's own option and then kills the pane", () => {
    const hook = args[args.length - 1];
    expect(hook).toContain(paneExitOptionName("mt-abc"));
    expect(hook).toContain("-gqF");
    expect(hook?.endsWith("; kill-pane")).toBe(true);
  });

  it("names a user option, which no pane's environment ever receives", () => {
    expect(paneExitOptionName("mt-abc")).toBe("@mt-exit-mt-abc");
  });
});

describe.skipIf(!hasTmux)("the recording against a real tmux", () => {
  const POLL_MS = 50;
  const POLL_LIMIT = 100;
  let dir = "";
  let socket = "";
  const env = { ...process.env, TMUX: undefined };
  const tmux = (args: string[]) => spawnCapture("tmux", ["-S", socket, "-f", "/dev/null", ...args], { env });
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const start = (name: string, script: string) => tmux(["new-session", "-d", "-s", name, "--", "sh", "-c", script, ...paneExitRecordingArgs(name)]);
  const sessionAlive = (name: string) => tmux(["has-session", "-t", `=${name}`]).status === 0;
  const recorded = (name: string) => tmux(["show-options", "-gqv", paneExitOptionName(name)]).stdout.trim();

  const untilEnded = async (name: string): Promise<boolean> => {
    for (let i = 0; i < POLL_LIMIT; i += 1) {
      if (!sessionAlive(name)) return true;
      await sleep(POLL_MS);
    }
    return false;
  };

  beforeAll(() => {
    // Short on purpose: a unix socket path past ~104 bytes cannot be bound, and os.tmpdir() alone
    // is already long on macOS.
    dir = mkdtempSync(path.join(os.tmpdir(), "mt-x-"));
    socket = path.join(dir, "s");
    tmux(["new-session", "-d", "-s", "bystander", "sleep 60"]);
  });

  afterAll(() => {
    tmux(["kill-server"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ["exits-0", "sleep 0.3; exit 0", 0],
    ["exits-3", "sleep 0.3; exit 3", 3],
    ["killed", "sleep 0.3; kill -9 $$", 128 + 9],
    ["segv", "sleep 0.3; kill -SEGV $$", 128 + 11],
  ])("records %s and still ends the session", async (name, script, code) => {
    expect(start(name, script).status).toBe(0);
    expect(await untilEnded(name)).toBe(true);
    expect(parsePaneExitRecord(recorded(name), SIGNALS)).toBe(code);
  });

  // Per session: a session started without it must keep tmux's defaults, so a shell cell neither
  // leaves a dead pane behind nor records anything.
  it("leaves every other session as it was", () => {
    expect(tmux(["show-options", "-w", "-v", "-t", "=bystander:", "remain-on-exit"]).stdout.trim()).toBe("");
    expect(tmux(["show-options", "-g", "-w", "-v", "remain-on-exit"]).stdout.trim()).toBe("off");
    expect(tmux(["show-hooks", "-g"]).stdout).not.toContain("@mt-exit");
    expect(recorded("bystander")).toBe("");
  });
});
