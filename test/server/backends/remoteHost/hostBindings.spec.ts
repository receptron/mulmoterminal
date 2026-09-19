// @vitest-environment node
//
// The WIRING of the phone's "open a terminal here" command, not the rule it calls.
//
// `decideLaunchTerminal` is pure and has its own spec; what this file covers is which facts the
// host hands it. That is where #2181 lived — the rule was right and the binding asked the wrong
// table, so a session the phone could SEE a directory for could not have a terminal opened in it.
// A spec over the rule alone stays green through that, which is why this one drives the binding.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PtyEntry } from "../../../../server/session/types.js";

const SURVIVOR_SESSION = "22222222-2222-4222-8222-222222222222";
const LIVE_CWD = "/repo/live";
const REMEMBERED_CWD = "/repo/remembered";

const { initRemoteHostBackend, sessionCwd, tmuxHeldSessionIdsAsync } = vi.hoisted(() => ({
  initRemoteHostBackend: vi.fn(),
  sessionCwd: vi.fn<(id: string) => string | null>(() => null),
  // The EXACT list of session ids tmux holds. `tmuxHasSession` is deliberately not used by the
  // code under test: tmux resolves `-t NAME` by prefix, so probing cannot answer "this one".
  tmuxHeldSessionIdsAsync: vi.fn<() => Promise<string[] | null>>(async () => []),
}));

vi.mock("../../../../server/backends/remoteHost/index.js", () => ({ initRemoteHostBackend }));
// Only the session listing is stubbed; shelling out to the real tmux would make this spec depend
// on whatever sessions happen to be running on the machine it is executed on.
vi.mock("../../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/infra/tmux.js")>()),
  tmuxHeldSessionIdsAsync,
}));
// `ptys` stays the REAL map — it is half of the lookup under test. Only the persisted side is
// stubbed, because recording a cwd for real appends to a file under MULMOTERMINAL_HOME, and the
// map's own persistence is registry.ts's business and has its own coverage.
vi.mock("../../../../server/session/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/session/registry.js")>()),
  sessionCwd,
}));

import { initRemoteHost } from "../../../../server/backends/remoteHost/hostBindings.js";
import { ptys } from "../../../../server/session/registry.js";
import { LAUNCH_TERMINAL_CHANNEL } from "../../../../common/launchAgent.js";

type LaunchTerminal = (agent: unknown, sessionId: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;

// The host only reads `.cwd` off the entry for this command; the rest of PtyEntry is a live pty
// and a socket that a wiring test has no business constructing.
const putLivePty = (id: string, cwd: string) => ptys.set(id, { cwd } as unknown as PtyEntry);

describe("initRemoteHost — launchTerminal wiring", () => {
  let publishToOne: ReturnType<typeof vi.fn>;
  let launchTerminal: LaunchTerminal;

  beforeEach(() => {
    ptys.clear();
    sessionCwd.mockReturnValue(null);
    tmuxHeldSessionIdsAsync.mockResolvedValue([]);
    initRemoteHostBackend.mockClear();
    publishToOne = vi.fn(() => true);
    initRemoteHost({
      spawnClaudePty: vi.fn(),
      toolStores: { toolCallsStore: { get: vi.fn() } },
      outputBufferLimit: 1024,
      publishToOne,
      subscriberCount: () => 1,
    } as never);
    launchTerminal = initRemoteHostBackend.mock.calls[0][0].launchTerminal;
  });

  afterEach(() => ptys.clear());

  // #2181. tmux survives a server restart by design, so this is the state after EVERY restart —
  // and the phone's own session list shows these rows WITH a directory, because it resolves one
  // the same way this now does.
  it("opens a terminal for a session that outlived a restart, in its remembered directory", async () => {
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    tmuxHeldSessionIdsAsync.mockResolvedValue([SURVIVOR_SESSION]);
    expect(await launchTerminal("claude", SURVIVOR_SESSION)).toEqual({ ok: true });
    // The agent is asserted too, and with a different value below: publishing a fixed one would
    // open a shell for a phone that asked for Claude — right directory, wrong program.
    expect(publishToOne).toHaveBeenCalledWith(LAUNCH_TERMINAL_CHANNEL, { agent: "claude", cwd: REMEMBERED_CWD });
  });

  // Where the agent is ACTUALLY running wins over the note on disk: a cell relaunched somewhere
  // else keeps its id and not its directory.
  it("prefers the live pty's directory over the remembered one", async () => {
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    putLivePty(SURVIVOR_SESSION, LIVE_CWD);
    // No tmux needed: a live pty is existence enough.
    expect(await launchTerminal("codex", SURVIVOR_SESSION)).toEqual({ ok: true });
    expect(publishToOne).toHaveBeenCalledWith(LAUNCH_TERMINAL_CHANNEL, { agent: "codex", cwd: LIVE_CWD });
  });

  // The remembered-cwd log is append-only and the phone's list is built from live ptys and tmux,
  // so an id in the log but in neither is one the phone could only have replayed. Serving it would
  // start a process in whatever that path is NOW (Codex review on PR #2190).
  it("refuses a remembered directory whose session no longer exists here", async () => {
    sessionCwd.mockReturnValue(REMEMBERED_CWD); // still on disk from weeks ago
    expect(await launchTerminal("claude", SURVIVOR_SESSION)).toEqual({ ok: false, error: expect.stringContaining("no longer running here") });
    expect(publishToOne).not.toHaveBeenCalled();
  });

  // The other half of the same hazard, and the one a shape test does NOT catch: a FULL uuid can be
  // a strict prefix of a longer tmux session name. Measured on tmux 3.6a — with only
  // `mt-<uuid>-suffix` running, `has-session -t mt-<uuid>` exits 0, and so do capture-pane and
  // display-message. Comparing against the listed names cannot do that (#2192).
  it("refuses a session that only exists as the prefix of a LONGER tmux name", async () => {
    tmuxHeldSessionIdsAsync.mockResolvedValue([`${SURVIVOR_SESSION}-suffix`]);
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    expect(await launchTerminal("claude", SURVIVOR_SESSION)).toEqual({ ok: false, error: expect.stringContaining("no longer running here") });
    expect(publishToOne).not.toHaveBeenCalled();
  });

  // tmux could not be ASKED — absent, or the socket unreadable. `tmuxHeldSessionIdsAsync` answers
  // null for that, and null is not "no sessions": it is "existence cannot be proven". Reading it as
  // "exists" would put every append-only remembered directory back in reach the moment tmux
  // hiccupped, which is the whole class this guard closes (Codex review, PR #2190 round 4).
  it("refuses when tmux could not be asked at all, rather than trusting the remembered directory", async () => {
    tmuxHeldSessionIdsAsync.mockResolvedValue(null);
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    expect(await launchTerminal("claude", SURVIVOR_SESSION)).toEqual({ ok: false, error: expect.stringContaining("no longer running here") });
    expect(publishToOne).not.toHaveBeenCalled();
  });

  // A malformed id never reaches tmux at all — cheaper, and it keeps junk out of a subprocess
  // argument.
  it("refuses an id that is not a session id, without asking tmux", async () => {
    tmuxHeldSessionIdsAsync.mockResolvedValue([SURVIVOR_SESSION]);
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    expect(await launchTerminal("claude", SURVIVOR_SESSION.slice(0, 8))).toEqual({ ok: false, error: expect.stringContaining("no longer running here") });
    expect(tmuxHeldSessionIdsAsync).not.toHaveBeenCalled();
    expect(publishToOne).not.toHaveBeenCalled();
  });

  it("still refuses a session nothing knows a directory for", async () => {
    tmuxHeldSessionIdsAsync.mockResolvedValue([SURVIVOR_SESSION]);
    expect(await launchTerminal("claude", SURVIVOR_SESSION)).toEqual({ ok: false, error: expect.stringContaining("no working directory known") });
    expect(publishToOne).not.toHaveBeenCalled();
  });

  // The directory resolving is not the whole answer: the grid lives in the browser, so with no tab
  // connected there is nothing to open the cell.
  it("refuses when no browser took the request, even though the directory resolved", async () => {
    sessionCwd.mockReturnValue(REMEMBERED_CWD);
    tmuxHeldSessionIdsAsync.mockResolvedValue([SURVIVOR_SESSION]);
    publishToOne.mockReturnValueOnce(false);
    expect((await launchTerminal("claude", SURVIVOR_SESSION)).ok).toBe(false);
    expect(publishToOne).toHaveBeenCalledOnce();
  });
});
