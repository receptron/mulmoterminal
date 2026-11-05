// @vitest-environment node
//
// startAgentPty is the last step of every agent spawner, so what each agent decides — program,
// argv, environment, the start line's note — must reach the pty and the registry unchanged.
// Driven over generated starts rather than one example, because the spawners differ exactly in
// those inputs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TERMINAL_AGENTS } from "../../../../common/sessionAgent.js";
import type { PtySpawnEnv } from "../../../../server/session/pty/pty-spawn.js";
import { seededRandom } from "../../../helpers/seededRandom.js";

interface SpawnCall {
  sessionId: string;
  file: string;
  args: string[];
  cwd: string;
  persistent: boolean;
  options: PtySpawnEnv | undefined;
}
const spawnCalls: SpawnCall[] = [];
const order: string[] = [];
const outcome = { tmux: true, reattached: false, pid: 1, throws: false };

vi.mock("../../../../server/session/pty/pty-spawn.js", () => ({
  ptySpawn: (sessionId: string, file: string, args: string[], cwd: string, persistent: boolean, options?: PtySpawnEnv) => {
    order.push("ptySpawn");
    spawnCalls.push({ sessionId, file, args, cwd, persistent, options });
    if (outcome.throws) throw new Error("spawn refused");
    return { term: { pid: outcome.pid }, tmux: outcome.tmux, reattached: outcome.reattached };
  },
}));

// Only the pty table: the real registry hydrates its logs from the user's home on import.
vi.mock("../../../../server/session/registry.js", () => ({ ptys: new Map() }));

const { startAgentPty } = await import("../../../../server/session/pty/agent-pty-start.js");
const { ptys } = await import("../../../../server/session/registry.js");

const GENERATED_STARTS = 200;
const random = seededRandom(1);
const { pick } = random;

const generateStart = (index: number) => {
  const spawnEnv: PtySpawnEnv = pick<PtySpawnEnv>([
    {},
    { env: { MULMOTERMINAL_SESSION_ID: `s${index}` }, binEnvVar: "GROK_BIN" },
    { binEnvVar: "COPILOT_BIN", env: { COPILOT_HOME: "/home/me/.copilot" } },
    { unset: ["ANTHROPIC_API_KEY"], env: {}, preflight: () => undefined },
  ]);
  return {
    sessionId: `11111111-2222-4333-8444-${String(index).padStart(12, "0")}`,
    ws: null,
    cwd: pick(["/w", "/home/me/project", "/tmp/with space"]),
    agent: pick(TERMINAL_AGENTS),
    file: pick(["claude", "ollama", "/usr/local/bin/cursor-agent"]),
    args: pick([[], ["--resume", "abc"], ["launch", "claude", "--", "--session-id", `s${index}`]]),
    spawnEnv,
    note: pick([null, "resume conv-1", "via nemotron resume x"]),
  };
};

let logged: string[] = [];
let clockMs = 0;
beforeEach(() => {
  spawnCalls.length = 0;
  order.length = 0;
  logged = [];
  ptys.clear();
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    order.push("log");
    logged.push(line);
  });
  vi.spyOn(Date, "now").mockImplementation(() => {
    order.push("now");
    return ++clockMs;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("startAgentPty", () => {
  it("hands every spawner's choices to the pty and the registry unchanged", () => {
    const agents = new Set<string>();
    for (let index = 1; index <= GENERATED_STARTS; index += 1) {
      const start = generateStart(index);
      agents.add(start.agent);
      Object.assign(outcome, { tmux: random.fraction() < 0.5, reattached: random.fraction() < 0.5, pid: index, throws: false });
      spawnCalls.length = 0;
      order.length = 0;
      logged = [];

      const { entry, spawnedAtMs, reattached } = startAgentPty(start);

      expect(spawnCalls).toEqual([
        {
          sessionId: start.sessionId,
          file: start.file,
          args: start.args,
          cwd: start.cwd,
          persistent: true,
          options: { ...start.spawnEnv, env: { ...start.spawnEnv.env, MULMOTERMINAL_SESSION_AGENT: start.agent }, recordExit: true },
        },
      ]);
      expect(entry).toEqual({
        term: { pid: index },
        ws: null,
        buffer: "",
        cwd: start.cwd,
        tmux: outcome.tmux,
        reattached: outcome.reattached,
        active: false,
        agent: start.agent,
      });
      expect(ptys.get(start.sessionId)).toBe(entry);
      expect(spawnedAtMs).toBe(clockMs);
      // codex picks its rollout tail from this, so it must be the pty's own answer, not a guess.
      expect(reattached).toBe(outcome.reattached);
      expect(order).toEqual(["ptySpawn", "now", "log"]);
      expect(logged).toHaveLength(1);
      const line = logged[0] ?? "";
      expect(line).toContain(outcome.reattached ? `attached to a running ${start.agent}` : `started ${start.agent}`);
      expect(line).toContain(`session ${start.sessionId}`);
      if (start.note !== null) expect(line).toContain(start.note);
    }
    // Every agent the picker knows, or one spawner's choices went unchecked.
    expect(agents.size).toBe(TERMINAL_AGENTS.length);
  });

  it("registers nothing and logs nothing when the pty refuses to start", () => {
    for (let index = 1; index <= GENERATED_STARTS; index += 1) {
      const start = generateStart(index);
      Object.assign(outcome, { throws: true });
      order.length = 0;
      expect(() => startAgentPty(start)).toThrow("spawn refused");
      expect(ptys.has(start.sessionId)).toBe(false);
      expect(order).toEqual(["ptySpawn"]);
    }
  });
});
