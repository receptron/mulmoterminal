// @vitest-environment node
// What a dead pty is evidence of (#1496).
//
// Under tmux the pty is the CLIENT, so its death says either "the agent finished" or "something
// killed our client while the agent kept running" — and the exit handlers used to read both as the
// first. The second is what a `signal=9` in the report was: nothing here sends SIGKILL (node-pty's
// `kill()` sends SIGHUP), so it came from outside, and reaping there ends a tmux session with a
// live agent in it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STARTUP_WINDOW_MS } from "../../../../common/endedCellClose";

const hasSession = vi.fn<(id: string) => boolean>(() => false);
const takeRecord = vi.fn<(id: string) => string | null>(() => null);
vi.mock("../../../../server/infra/process/tmux.js", () => ({
  tmuxHasSession: (id: string) => hasSession(id),
  tmuxTakePaneExitRecord: (id: string) => takeRecord(id),
}));

// The real one appends to ~/.mulmoterminal, which a spec must not write.
const placed = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../../../../server/session/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/session/registry.js")>()),
  markSessionPlaced: (id: string) => placed.ids.push(id),
}));

const { isCurrentPty, ptyExitDisposition, reportPtyExit, sessionEndedForCell } = await import("../../../../server/session/pty/pty-exit.js");
const { ptys } = await import("../../../../server/session/registry.js");

type Entry = NonNullable<ReturnType<typeof ptys.get>>;
// Only `tmux` and `ws` are read here; the rest of the entry stands in for a live pty.
const entryOf = (tmux: boolean, ws: unknown = null): Entry => ({ tmux, ws, cwd: "/repo", agent: "claude" }) as unknown as Entry;
const register = (id: string, tmux: boolean, ws: unknown = null): Entry => {
  const entry = entryOf(tmux, ws);
  ptys.set(id, entry);
  return entry;
};

beforeEach(() => {
  ptys.clear();
  placed.ids.length = 0;
  // Cleared, not just re-stubbed: the "never asks tmux" assertion below reads the CALL COUNT, and
  // a shared mock carries the previous test's calls into it.
  hasSession.mockClear();
  hasSession.mockReturnValue(false);
  takeRecord.mockClear();
  takeRecord.mockReturnValue(null);
});

describe("ptyExitDisposition", () => {
  it("keeps a session whose tmux is still running — only the client died", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: true, tmuxAlive: true })).toBe("keep");
  });

  it("reaps when tmux no longer has the session — the agent really exited", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: true, tmuxAlive: false })).toBe("reap");
  });

  // Without tmux nothing can outlive the pty, so its death is the session's death.
  it("reaps a pty that was never tmux-backed", () => {
    expect(ptyExitDisposition({ stillRegistered: true, tmuxBacked: false, tmuxAlive: false })).toBe("reap");
  });

  // The close button reaps first and the pty dies afterwards, so the exit arrives with nothing to
  // act on. Reaping again is harmless, but "gone" is the honest answer and keeps the log quiet.
  it("does nothing for a session that was already torn down", () => {
    expect(ptyExitDisposition({ stillRegistered: false, tmuxBacked: true, tmuxAlive: true })).toBe("gone");
  });
});

const EXIT = { exitCode: 0, signal: undefined, lifetimeMs: 60_000 };
// The entry that exited is the one registered, unless a test says otherwise.
const handlePtyExit = (id: string, reap: (id: string) => void) => reportPtyExit(id, ptys.get(id) ?? entryOf(true), EXIT, reap);

describe("reportPtyExit — applying the decision", () => {
  it("does not reap a session tmux still has, and drops the dead pty entry", () => {
    const reap = vi.fn();
    register("s-1", true);
    hasSession.mockReturnValue(true);

    expect(handlePtyExit("s-1", reap)).toBe("keep");
    expect(reap).not.toHaveBeenCalled();
    // The entry MUST go: `ptys.has()` is what every reconnect path reads as "there is a live pty
    // here", so a dead one left behind would be reused instead of reattached.
    expect(ptys.has("s-1")).toBe(false);
  });

  it("reaps when the tmux session went with the program", () => {
    const reap = vi.fn();
    register("s-1", true);
    hasSession.mockReturnValue(false);

    expect(handlePtyExit("s-1", reap)).toBe("reap");
    expect(reap).toHaveBeenCalledWith("s-1");
  });

  // Asked only when it could matter: a non-tmux pty has nothing that could outlive it, and the
  // question shells out to tmux.
  it("does not ask tmux about a pty that was never tmux-backed", () => {
    const reap = vi.fn();
    register("s-1", false);

    expect(handlePtyExit("s-1", reap)).toBe("reap");
    expect(hasSession).not.toHaveBeenCalled();
    expect(reap).toHaveBeenCalledWith("s-1");
  });

  it("neither reaps nor logs for a session that is already gone", () => {
    const reap = vi.fn();
    hasSession.mockReturnValue(true);

    expect(handlePtyExit("never-registered", reap)).toBe("gone");
    expect(reap).not.toHaveBeenCalled();
  });
});

// The browser closes an agent cell on `ended` (#3049), so the frame must say the SESSION ended only
// when it did: a lost tmux client is a live agent, and a cell closing on it drops that agent.
describe("reportPtyExit — what the exit frame tells the browser", () => {
  const socketRecording = (events: string[]) => {
    const frames: unknown[] = [];
    const socket = {
      readyState: 1,
      OPEN: 1,
      send: (data: string) => {
        events.push("frame");
        frames.push(JSON.parse(data));
      },
      close: () => undefined,
    };
    return { socket, frames };
  };

  it.each([
    { name: "the session went with the program", tmuxAlive: false, registered: true, ended: true },
    { name: "only the tmux client died", tmuxAlive: true, registered: true, ended: false },
    { name: "an explicit close already reaped it", tmuxAlive: false, registered: false, ended: false },
    // #3067: the close route reaps first too, but asked for the cell to go.
    { name: "the close route reaped it", tmuxAlive: false, registered: false, ended: true, closeRequested: true },
  ])("$name → ended: $ended", ({ tmuxAlive, registered, ended, closeRequested }) => {
    const { socket, frames } = socketRecording([]);
    const exiting = registered ? register("s-1", true, socket) : entryOf(true, socket);
    if (closeRequested) exiting.closeRequested = true;
    hasSession.mockReturnValue(tmuxAlive);

    reportPtyExit("s-1", exiting, EXIT, vi.fn());

    expect(frames).toEqual([{ type: "exit", exitCode: 0, lifetimeMs: 60_000, reattached: false, ended }]);
  });

  // A reattached pty's lifetime is not the agent's; the browser needs to know which it got.
  it("says whether the pty had attached to an agent already running", () => {
    const { socket, frames } = socketRecording([]);
    const exiting = register("s-1", true, socket);
    exiting.reattached = true;

    reportPtyExit("s-1", exiting, EXIT, vi.fn());

    expect(frames).toEqual([{ type: "exit", exitCode: 0, lifetimeMs: 60_000, reattached: true, ended: true }]);
  });

  it("sends the frame before the reap tears the session down", () => {
    const events: string[] = [];
    const { socket } = socketRecording(events);
    const exiting = register("s-1", true, socket);

    reportPtyExit("s-1", exiting, EXIT, () => events.push("reap"));

    expect(events).toEqual(["frame", "reap"]);
  });
});

// An explicit close or a restart (#1918) unregisters the old pty first, and the replacement can be
// registered under the same id before the old process's exit arrives.
describe("reportPtyExit — a stale exit after the id was reused", () => {
  it.each([
    { name: "the replacement's tmux is alive", tmuxAlive: true },
    { name: "tmux says no session", tmuxAlive: false },
  ])("leaves the replacement alone when $name", ({ tmuxAlive }) => {
    const old = entryOf(true);
    const replacement = register("s-1", true);
    hasSession.mockReturnValue(tmuxAlive);
    const reap = vi.fn();

    expect(reportPtyExit("s-1", old, EXIT, reap)).toBe("gone");
    expect(reap).not.toHaveBeenCalled();
    expect(ptys.get("s-1")).toBe(replacement);
  });

  it("tells the old socket the session did not end", () => {
    const frames: unknown[] = [];
    const old = entryOf(true, { readyState: 1, OPEN: 1, send: (d: string) => frames.push(JSON.parse(d)), close: () => undefined });
    register("s-1", true);

    reportPtyExit("s-1", old, EXIT, vi.fn());

    expect(frames).toEqual([{ type: "exit", exitCode: 0, lifetimeMs: 60_000, reattached: false, ended: false }]);
  });
});

describe("isCurrentPty", () => {
  it("is true only for the very entry registered under the id", () => {
    const entry = register("s-1", true);
    expect(isCurrentPty("s-1", entry)).toBe(true);
    expect(isCurrentPty("s-1", entryOf(true))).toBe(false);
    expect(isCurrentPty("s-2", entry)).toBe(false);
  });
});

// A session an agent opened with no grid on screen waits to be adopted by the next one. When it ends
// in a way that would have closed an open cell, nothing should adopt it later (#3055).
describe("reportPtyExit — the unplaced mark of a session that ended", () => {
  const exitAfter = (lifetimeMs: number) => ({ exitCode: 0, signal: undefined, lifetimeMs });

  it("is dropped when the agent ended after it had started", () => {
    register("s-1", true);
    reportPtyExit("s-1", ptys.get("s-1") ?? entryOf(true), exitAfter(STARTUP_WINDOW_MS), vi.fn());
    expect(placed.ids).toEqual(["s-1"]);
  });

  it("is dropped for a reattached pty however soon the agent ended", () => {
    const entry = register("s-1", true);
    entry.reattached = true;
    reportPtyExit("s-1", entry, exitAfter(0), vi.fn());
    expect(placed.ids).toEqual(["s-1"]);
  });

  it.each([
    { name: "only the tmux client died", tmuxAlive: true, lifetimeMs: 60_000, cwd: "/repo", stale: false },
    { name: "the agent died while starting", tmuxAlive: false, lifetimeMs: STARTUP_WINDOW_MS - 1, cwd: "/repo", stale: false },
    { name: "it runs in a worktree", tmuxAlive: false, lifetimeMs: 60_000, cwd: "/home/me/proj/.claude/worktrees/proj-0123abcd/task", stale: false },
    { name: "the exit is a stale one after the id was reused", tmuxAlive: false, lifetimeMs: 60_000, cwd: "/repo", stale: true },
  ])("is kept when $name", ({ tmuxAlive, lifetimeMs, cwd, stale }) => {
    const registered = register("s-1", true);
    registered.cwd = cwd;
    const exiting = stale ? { ...entryOf(true), cwd } : registered;
    hasSession.mockReturnValue(tmuxAlive);

    reportPtyExit("s-1", exiting, exitAfter(lifetimeMs), vi.fn());

    expect(placed.ids).toEqual([]);
  });
});

// #3067. The close route reaps before the pty dies, as terminate does — the exit is `gone` either way,
// and only the request says whether the cell should go. A restart (#1918) never sets it.
describe("sessionEndedForCell", () => {
  it.each([
    { disposition: "reap", closeRequested: false, ended: true },
    { disposition: "reap", closeRequested: true, ended: true },
    { disposition: "gone", closeRequested: true, ended: true },
    { disposition: "gone", closeRequested: false, ended: false },
    { disposition: "keep", closeRequested: false, ended: false },
    { disposition: "keep", closeRequested: true, ended: false },
  ] as const)("$disposition, close requested: $closeRequested → $ended", ({ disposition, closeRequested, ended }) => {
    expect(sessionEndedForCell(disposition, closeRequested)).toBe(ended);
  });
});

describe("reportPtyExit — a session the close route ended", () => {
  it("drops its unplaced mark, so no grid adopts it later", () => {
    const closed = entryOf(true);
    closed.closeRequested = true;
    reportPtyExit("s-1", closed, { exitCode: 0, signal: undefined, lifetimeMs: STARTUP_WINDOW_MS }, vi.fn());
    expect(placed.ids).toEqual(["s-1"]);
  });
});

// Under tmux our pty is the client and always exits 0; tmux recorded what the program did (#3272).
describe("reportPtyExit — the program's own exit code", () => {
  const registerRecording = () => {
    const frames: Array<{ exitCode?: unknown }> = [];
    const socket = { readyState: 1, OPEN: 1, send: (d: string) => frames.push(JSON.parse(d)), close: () => undefined };
    return { exiting: register("s-1", true, socket), frames };
  };

  it.each([
    { record: ":kill", exitCode: 137 },
    { record: ":segv", exitCode: 139 },
    { record: "1:", exitCode: 1 },
  ])("sends $exitCode for a $record and keeps the session adoptable", ({ record, exitCode }) => {
    const { exiting, frames } = registerRecording();
    takeRecord.mockReturnValue(record);

    expect(reportPtyExit("s-1", exiting, EXIT, vi.fn())).toBe("reap");

    expect(takeRecord).toHaveBeenCalledWith("s-1");
    expect(frames[0]?.exitCode).toBe(exitCode);
    expect(placed.ids).toEqual([]);
  });

  it("closes as before for a recorded clean exit", () => {
    const { exiting, frames } = registerRecording();
    takeRecord.mockReturnValue("0:");

    reportPtyExit("s-1", exiting, EXIT, vi.fn());

    expect(frames[0]?.exitCode).toBe(0);
    expect(placed.ids).toEqual(["s-1"]);
  });

  // No record (a shell cell, psmux, a session from before) or one it cannot read: the client's code.
  it.each([null, "", "garbage", ":nosuchsignal"])("keeps the client's code when the record is %j", (record) => {
    const { exiting, frames } = registerRecording();
    takeRecord.mockReturnValue(record);

    reportPtyExit("s-1", exiting, { ...EXIT, exitCode: 5 }, vi.fn());

    expect(frames[0]?.exitCode).toBe(5);
  });

  // A kept session is still running and a gone one was ended by us: neither has anything to read,
  // and a non-tmux pty's code is already the program's.
  it.each([
    { name: "only the client died", tmux: true, tmuxAlive: true, registered: true },
    { name: "the close route already reaped it", tmux: true, tmuxAlive: false, registered: false },
    { name: "the pty was never tmux-backed", tmux: false, tmuxAlive: false, registered: true },
  ])("does not ask tmux when $name", ({ tmux, tmuxAlive, registered }) => {
    const exiting = registered ? register("s-1", tmux) : entryOf(tmux);
    hasSession.mockReturnValue(tmuxAlive);
    takeRecord.mockReturnValue(":kill");

    reportPtyExit("s-1", exiting, EXIT, vi.fn());

    expect(takeRecord).not.toHaveBeenCalled();
  });
});
