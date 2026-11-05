// @vitest-environment node
//
// How an agent's pane ended (#3272). The parser and the wrapper's argv are checked directly, and the
// wrapper itself under a REAL tmux on a throwaway `-S` server with `$TMUX` removed and HOME pointed
// at a scratch directory, so neither the live `-L mulmoterminal` server nor a real home is reached.
// That half is skipped where there is no tmux: what it pins is how a shell, a pty and tmux behave
// together, which no fake could stand in for.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PANE_EXIT_DIR_SEGMENTS, paneExitWrapped, parsePaneExitRecord } from "../../../../server/infra/process/tmux-pane-exit";
import { spawnCapture } from "../../../../server/infra/process/spawnCapture";

const hasTmux = process.platform !== "win32" && spawnCapture("tmux", ["-V"]).status === 0;

describe("parsePaneExitRecord", () => {
  it.each([
    ["0", 0],
    ["1", 1],
    ["137", 137],
    ["3\n", 3],
    ["  2  ", 2],
  ])("reads %j as %i", (record, code) => {
    expect(parsePaneExitRecord(record)).toBe(code);
  });

  it.each(["", " ", "-1", "1.5", "abc", "1 2", "3:", ":kill", "0x10", "١"])("says nothing for a record it cannot read (%j)", (record) => {
    expect(parsePaneExitRecord(record)).toBeNull();
  });
});

describe("paneExitWrapped", () => {
  const argv = ["--model", "a b", "x;y", '"$HOME"', "", "-c"];
  const wrapped = paneExitWrapped("mt-abc", "/usr/bin/claude", argv);

  it("runs under an absolute /bin/sh", () => {
    expect(wrapped.file).toBe("/bin/sh");
    expect(wrapped.args[0]).toBe("-c");
  });

  // Everything after the script is positional, so the program and its arguments reach `"$@"` as
  // they were — no word in them is ever parsed by the shell.
  it("passes the session name, then the program and its argv unchanged", () => {
    expect(wrapped.args.slice(3)).toEqual(["mt-abc", "/usr/bin/claude", ...argv]);
  });

  it("keeps Ctrl+C reaching the program: the signal is handled, never ignored", () => {
    expect(wrapped.args[1]).toContain("trap : INT QUIT");
    expect(wrapped.args[1]).not.toContain("trap ''");
  });
});

describe.skipIf(!hasTmux)("the recorder under a real tmux", () => {
  const POLL_MS = 50;
  // Generous: a loaded CI runner is slower than any machine this was measured on.
  const POLL_LIMIT = 200;
  const CONCURRENT_SESSIONS = 20;
  let dir = "";
  let socket = "";
  const env = () => ({ ...process.env, TMUX: undefined, HOME: dir });
  const tmux = (args: string[]) => spawnCapture("tmux", ["-S", socket, "-f", "/dev/null", ...args], { env: env() });
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const homeFile = (...segments: string[]) => path.join(dir, ...segments);
  const readIfThere = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const recorded = (name: string) => readIfThere(homeFile(...PANE_EXIT_DIR_SEGMENTS, name));
  // The program writes its own pid first, so a test can signal IT rather than the wrapper.
  const program = (name: string, rest: string) => `echo $$ > "$HOME/pid-${name}"; ${rest}`;
  const start = (name: string, script: string) => {
    const pane = paneExitWrapped(name, "sh", ["-c", program(name, script)]);
    return tmux(["new-session", "-d", "-s", name, "--", pane.file, ...pane.args]);
  };
  const programPid = async (name: string): Promise<number> => {
    for (let i = 0; i < POLL_LIMIT && readIfThere(homeFile(`pid-${name}`)).trim() === ""; i += 1) await sleep(POLL_MS);
    return Number(readIfThere(homeFile(`pid-${name}`)).trim());
  };
  const sessionAlive = (name: string) => tmux(["has-session", "-t", `=${name}`]).status === 0;
  const untilEnded = async (name: string): Promise<boolean> => {
    for (let i = 0; i < POLL_LIMIT; i += 1) {
      if (!sessionAlive(name)) return true;
      await sleep(POLL_MS);
    }
    return false;
  };
  const deadPanes = () =>
    tmux(["list-panes", "-a", "-F", "#{pane_dead}"])
      .stdout.split("\n")
      .filter((line) => line.trim() === "1").length;

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

  // First and alone on purpose: the server exits with its last session, so a record kept anywhere in
  // tmux would be gone before anyone read it.
  it("records a crash of the server's last session", async () => {
    expect(start("alone", "sleep 30").status).toBe(0);
    process.kill(await programPid("alone"), "SIGKILL");
    expect(await untilEnded("alone")).toBe(true);
    expect(tmux(["ls"]).status).not.toBe(0);
    expect(parsePaneExitRecord(recorded("alone"))).toBe(128 + 9);
  });

  describe("beside another session", () => {
    beforeAll(() => {
      tmux(["new-session", "-d", "-s", "bystander", "sleep 600"]);
    });

    it.each([
      ["exits-0", "sleep 0.2; exit 0", 0],
      ["exits-3", "sleep 0.2; exit 3", 3],
      ["instant", "exit 7", 7],
    ])("records %s and ends the session", async (name, script, code) => {
      expect(start(name, script).status).toBe(0);
      expect(await untilEnded(name)).toBe(true);
      expect(parsePaneExitRecord(recorded(name))).toBe(code);
    });

    it.each([
      ["killed", "SIGKILL", 128 + 9],
      ["segv", "SIGSEGV", 128 + 11],
    ] as const)("records %s as 128 + the signal", async (name, signal, code) => {
      expect(start(name, "sleep 30").status).toBe(0);
      process.kill(await programPid(name), signal);
      expect(await untilEnded(name)).toBe(true);
      expect(parsePaneExitRecord(recorded(name))).toBe(code);
    });

    // An agent clears its input on the first Ctrl+C and keeps running. The wrapper shares its process
    // group, so it is sent the same SIGINT — and must keep waiting rather than end the session.
    it("survives a Ctrl+C the program survives, and records the exit that follows", async () => {
      expect(start("ctrl-c", 'n=0; trap "n=\\$((n+1)); [ \\$n -ge 2 ] && exit 3" INT; while :; do sleep 0.1; done').status).toBe(0);
      await programPid("ctrl-c");
      tmux(["send-keys", "-t", "=ctrl-c:", "C-c"]);
      await sleep(POLL_MS * 10);
      expect(sessionAlive("ctrl-c")).toBe(true);
      tmux(["send-keys", "-t", "=ctrl-c:", "C-c"]);
      expect(await untilEnded("ctrl-c")).toBe(true);
      expect(parsePaneExitRecord(recorded("ctrl-c"))).toBe(3);
    });

    it("hands the program its argv untouched", async () => {
      const tricky = ["a b", "x;y", "$HOME", '"q"', ""];
      const pane = paneExitWrapped("argv", "sh", ["-c", 'printf "%s|" "$@" > "$HOME/argv-seen"', "sh", ...tricky]);
      expect(tmux(["new-session", "-d", "-s", "argv", "--", pane.file, ...pane.args]).status).toBe(0);
      expect(await untilEnded("argv")).toBe(true);
      expect(readIfThere(homeFile("argv-seen"))).toBe(`${tricky.join("|")}|`);
    });

    // The property the tmux-hook design lost under load: started together, every session still ends
    // and records, and no dead pane is ever left on screen.
    it("leaves no session and no dead pane behind when many end together", async () => {
      const names = Array.from({ length: CONCURRENT_SESSIONS }, (_, i) => `many-${String(i).padStart(2, "0")}`);
      names.forEach((name, i) => start(name, `sleep 0.${i % 5}; exit ${i % 4}`));
      const ended = await Promise.all(names.map(untilEnded));
      expect(ended.every(Boolean)).toBe(true);
      expect(names.map((name) => parsePaneExitRecord(recorded(name)))).toEqual(names.map((_, i) => i % 4));
      expect(deadPanes()).toBe(0);
    });

    it("leaves every other session as it was", () => {
      expect(sessionAlive("bystander")).toBe(true);
      expect(tmux(["show-options", "-g", "-w", "-v", "remain-on-exit"]).stdout.trim()).toBe("off");
      expect(recorded("bystander")).toBe("");
    });
  });
});
