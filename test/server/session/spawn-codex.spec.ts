// @vitest-environment node
// The three ways spawnCodexPty can meet a rollout, pinned together because the branch between
// them is what #1536 was: a tmux attach after a server restart took the FRESH branch, whose
// watcher waits for a rollout file to APPEAR — and the surviving session's file already existed,
// so nothing ever tailed it and the cell's working/waiting flags stayed dead until a cold
// restart. Claude survives the same restart via its HTTP hooks; codex has only this tail.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodexSpawner } from "../../../server/session/spawn-codex.js";
import { ptys } from "../../../server/session/registry.js";
import type { SpawnDeps } from "../../../server/session/spawn-deps.js";
import { codexPermissionHookOverride } from "../../../server/agents/codex-hook.js";

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01";
const ROLLOUT_ID = "11111111-2222-4333-8444-555555555555";

const mocks = vi.hoisted(() => ({
  // What ptySpawn reports back — the reattached flag IS the case under test.
  reattached: false,
  argv: [] as string[][],
  envs: [] as Record<string, string>[],
  tracked: [] as { sessionId: string; file: string; mode: unknown }[],
  remembered: [] as { sessionId: string; conversationId: string; cwd: string }[],
  watcherRuns: 0,
  // The hydrated session -> rollout mapping, as the WS route's awaited hydration leaves it.
  rollouts: new Map<string, { sessionId: string; conversationId: string; cwd: string; startedAt: number }>(),
}));

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: vi.fn((_id: string, _bin: string, args: string[], _cwd: string, _persistent: boolean, options?: { env?: Record<string, string> }) => {
    mocks.argv.push(args);
    mocks.envs.push(options?.env ?? {});
    return { term: { pid: 1234, onData: vi.fn(), onExit: vi.fn() }, tmux: true, reattached: mocks.reattached };
  }),
  ptyWouldReattach: vi.fn(() => mocks.reattached),
}));

// The watcher polls codex's real sessions root for the session's lifetime, and `remember`
// appends to the real ~/.mulmoterminal log. Both are stubbed: this file is about which branch
// the spawner takes, and a unit test must not write a session that never existed into the
// developer's own state.
vi.mock("../../../server/agents/codex-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/codex-session.js")>()),
  codexSessionsRoot: () => "/codex-root",
  snapshotSessions: () => new Set<string>(),
  watchForCodexSession: vi.fn(() => {
    mocks.watcherRuns += 1;
    return new Promise(() => {}); // never resolves — the fresh branch is asserted by the call alone
  }),
}));

vi.mock("../../../server/agents/codex-sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/codex-sessions.js")>()),
  codexRolloutPath: (_root: string, id: string) => `/codex-root/rollout-${id}.jsonl`,
}));

vi.mock("../../../server/session/codex-activity-track.js", () => ({
  trackCodexActivity: vi.fn((sessionId: string, file: string, mode: unknown) => {
    mocks.tracked.push({ sessionId, file, mode });
  }),
}));

vi.mock("../../../server/session/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/registry.js")>()),
  codexRollouts: mocks.rollouts,
  rememberCodexRollout: vi.fn((sessionId: string, conversationId: string, cwd: string) => {
    mocks.remembered.push({ sessionId, conversationId, cwd });
  }),
  claimFullGuiMcp: vi.fn(() => false), // persists a claim log on the real disk
}));

describe("createCodexSpawner", () => {
  const dummyDeps = {
    codexBin: "codex",
    codexModel: null,
    outputBufferLimit: 10000,
    uiPort: "3000",
    reap: vi.fn(),
    setWorking: vi.fn(),
    setWaiting: vi.fn(),
  } as unknown as SpawnDeps;
  const spawn = () => createCodexSpawner(dummyDeps).spawnCodexPty;

  beforeEach(() => {
    ptys.clear();
    mocks.reattached = false;
    mocks.argv.length = 0;
    mocks.envs.length = 0;
    mocks.tracked.length = 0;
    mocks.remembered.length = 0;
    mocks.watcherRuns = 0;
    mocks.rollouts.clear();
  });

  it("watches for a fresh session's rollout to appear, and tails nothing yet", () => {
    spawn()(SID, null, null, "/w", false);
    expect(mocks.watcherRuns).toBe(1);
    expect(mocks.tracked).toEqual([]);
    expect(ptys.get(SID)?.agent).toBe("codex");
  });

  it("tails a resumed rollout from the end, records the mapping, and runs no watcher", () => {
    spawn()(SID, null, ROLLOUT_ID, "/w", false);
    // No restoreOpenTurn: the resumed process is NEW, so a turn the old rollout left open is
    // one the OLD process died inside — the resumed session is idle.
    expect(mocks.tracked).toEqual([{ sessionId: SID, file: `/codex-root/rollout-${ROLLOUT_ID}.jsonl`, mode: { startAtEnd: true } }]);
    expect(mocks.remembered).toEqual([{ sessionId: SID, conversationId: ROLLOUT_ID, cwd: "/w" }]);
    expect(mocks.watcherRuns).toBe(0);
    expect(mocks.argv.at(-1)).toContain(ROLLOUT_ID);
  });

  // The #1536 case: a tmux attach after a server restart. The resume id is rightly withheld (a
  // `codex resume` would start a second process beside the surviving one), so activity has to be
  // re-armed from the hydrated mapping — from the END, or days-old turns would flag the cell.
  it("re-arms activity from the hydrated mapping on a tmux reattach, without a resume argv", () => {
    mocks.reattached = true;
    mocks.rollouts.set(SID, { sessionId: SID, conversationId: ROLLOUT_ID, cwd: "/w", startedAt: 1 });
    spawn()(SID, null, null, "/w", false);
    // restoreOpenTurn: the surviving process may be MID-TURN right now, and tailing from the
    // end alone would show it idle until that turn's end boundary arrives.
    expect(mocks.tracked).toEqual([{ sessionId: SID, file: `/codex-root/rollout-${ROLLOUT_ID}.jsonl`, mode: { startAtEnd: true, restoreOpenTurn: true } }]);
    expect(mocks.watcherRuns).toBe(0);
    expect(mocks.argv.at(-1)).not.toContain("resume");
    // The mapping is already on disk with the cwd the session really runs in; a reattach request's
    // cwd is the least trustworthy value on this path and must not overwrite it.
    expect(mocks.remembered).toEqual([]);
  });

  // No mapping means the restart came before the survivor's FIRST turn — no rollout exists yet,
  // but its first prompt may still be coming. The appear-watcher must run exactly as it does for
  // a fresh session, or that rollout is never recorded and a later cold reconnect starts a new
  // conversation instead of resuming this one (Codex review on #1538).
  it("falls back to the appear-watcher on a tmux reattach with no known rollout", () => {
    mocks.reattached = true;
    spawn()(SID, null, null, "/w", false);
    expect(mocks.tracked).toEqual([]);
    expect(mocks.watcherRuns).toBe(1);
  });

  // The hook's command is a constant, so what makes it this session's is the environment it runs
  // in: the override without the id posts nothing anyone can attribute.
  it.skipIf(process.platform === "win32")("registers the permission hook on an interactive spawn, with the session in the env", () => {
    spawn()(SID, null, null, "/w", false);
    expect(mocks.argv.at(-1)).toContain(codexPermissionHookOverride());
    expect(mocks.envs.at(-1)).toMatchObject({ MULMOTERMINAL_SESSION_ID: SID });
    expect(mocks.envs.at(-1)?.MULMOTERMINAL_PORT).toMatch(/^\d+$/);
  });

  // A seed prompt is typed once the screen settles, and the one-time trust dialog would take it.
  it("registers no permission hook when the spawn types a seed prompt", () => {
    spawn()(SID, null, null, "/w", false, { initialPrompt: "run the collection action" });
    expect(mocks.argv.at(-1)).not.toContain(codexPermissionHookOverride());
  });
});
