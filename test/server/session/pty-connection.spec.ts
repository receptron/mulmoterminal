import { describe, it, expect } from "vitest";
import { createConnectionHandlers, handleCommandFrame } from "../../../server/session/pty-connection.js";
import type { PtyEntry } from "../../../server/session/types.js";

const OPEN = 1;
const CLOSED = 3;
const SESSION = "11111111-2222-3333-4444-555555555555";

// Records what the PTY and the socket were asked to do, so a frame's effect can be
// asserted without a real terminal or connection.
function fakeTerm() {
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  return {
    writes,
    resizes,
    term: {
      pid: 4242,
      write: (d: string) => {
        writes.push(d);
      },
      resize: (cols: number, rows: number) => {
        resizes.push([cols, rows]);
      },
    },
  };
}

function fakeSocket(readyState = OPEN) {
  const sent: string[] = [];
  let closed = 0;
  return {
    sent,
    closeCount: () => closed,
    parsed: () => sent.map((s) => JSON.parse(s)),
    ws: {
      readyState,
      OPEN,
      send: (d: string) => {
        sent.push(d);
      },
      close: () => {
        closed++;
      },
    },
  };
}

function setup() {
  const calls: string[] = [];
  const handlers = createConnectionHandlers({
    cancelReap: (id) => calls.push(`cancelReap:${id}`),
    reap: (id) => calls.push(`reap:${id}`),
    setWaiting: (id, waiting) => calls.push(`setWaiting:${id}:${waiting}`),
    armReapForDetached: (id) => calls.push(`armReap:${id}`),
  });
  return { ...handlers, calls };
}

// PtyEntry carries fields these handlers never touch; the fakes model the ones they do.
function entryWith(over: Partial<PtyEntry> = {}) {
  const { term } = fakeTerm();
  return { term, ws: null, buffer: "", cwd: "/ws", active: false, agent: "claude", ...over } as unknown as PtyEntry;
}

describe("handleClientFrame", () => {
  const frame = (o: unknown) => JSON.stringify(o);

  it("writes an input frame to the pty", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "input", data: "ls\r" }), SESSION);
    expect(t.writes).toEqual(["ls\r"]);
  });

  it("resizes on a valid resize frame", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 100, rows: 40 }), SESSION);
    expect(t.resizes).toEqual([[100, 40]]);
  });

  it("ignores a resize outside the allowed bounds", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "resize", cols: 0, rows: 99999 }), SESSION);
    expect(t.resizes).toEqual([]);
  });

  it("reaps immediately on terminate rather than waiting out the grace window", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "terminate" }), SESSION);
    expect(calls).toEqual([`reap:${SESSION}`]);
  });

  it("marks an activated pane read, and only tracks the flag when deactivated", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never });

    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: true }), SESSION);
    expect(entry.active).toBe(true);
    expect(calls).toEqual([`setWaiting:${SESSION}:false`]);

    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: false }), SESSION);
    expect(entry.active).toBe(false);
    expect(calls).toHaveLength(1); // deactivating must not clear the attention flag
  });

  it("ignores a view frame whose active flag is not a boolean", () => {
    const { handleClientFrame, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    handleClientFrame(entry, s.ws as never, frame({ type: "view", active: "yes" }), SESSION);
    expect(entry.active).toBe(true);
    expect(calls).toEqual([]);
  });

  it("ignores frames from a socket a newer client has superseded", () => {
    // Two tabs on one session: the older socket must not drive the pty the newer one owns.
    const { handleClientFrame, calls } = setup();
    const t = fakeTerm();
    const current = fakeSocket();
    const stale = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: current.ws as never });
    handleClientFrame(entry, stale.ws as never, frame({ type: "input", data: "rm -rf /" }), SESSION);
    handleClientFrame(entry, stale.ws as never, frame({ type: "terminate" }), SESSION);
    expect(t.writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("never writes a non-JSON payload to the pty", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, "not json at all", SESSION);
    expect(t.writes).toEqual([]);
  });

  it("ignores an unknown frame type and a non-string input payload", () => {
    const { handleClientFrame } = setup();
    const t = fakeTerm();
    const s = fakeSocket();
    const entry = entryWith({ term: t.term as never, ws: s.ws as never });
    handleClientFrame(entry, s.ws as never, frame({ type: "whatever" }), SESSION);
    handleClientFrame(entry, s.ws as never, frame({ type: "input", data: { evil: true } }), SESSION);
    expect(t.writes).toEqual([]);
  });

  it("survives a pty that throws mid-write instead of crashing the server", () => {
    // A write racing the pty's exit throws; dropping the frame is the whole point.
    const { handleClientFrame } = setup();
    const s = fakeSocket();
    const entry = entryWith({
      ws: s.ws as never,
      term: {
        write: () => {
          throw new Error("EIO");
        },
      } as never,
    });
    expect(() => handleClientFrame(entry, s.ws as never, frame({ type: "input", data: "x" }), SESSION)).not.toThrow();
  });
});

// The Run menu's terminal has no session identity, so it accepts only input/resize —
// never terminate, which would reach for session machinery that isn't there.
describe("handleCommandFrame", () => {
  const frame = (o: unknown) => JSON.stringify(o);

  it("writes input and applies a valid resize", () => {
    const t = fakeTerm();
    handleCommandFrame(t.term as never, frame({ type: "input", data: "echo hi\r" }));
    handleCommandFrame(t.term as never, frame({ type: "resize", cols: 80, rows: 24 }));
    expect(t.writes).toEqual(["echo hi\r"]);
    expect(t.resizes).toEqual([[80, 24]]);
  });

  it("ignores terminate and view — this terminal has no session to act on", () => {
    const t = fakeTerm();
    handleCommandFrame(t.term as never, frame({ type: "terminate" }));
    handleCommandFrame(t.term as never, frame({ type: "view", active: true }));
    expect(t.writes).toEqual([]);
    expect(t.resizes).toEqual([]);
  });

  it("ignores malformed JSON and out-of-bounds resizes", () => {
    const t = fakeTerm();
    handleCommandFrame(t.term as never, "{{{");
    handleCommandFrame(t.term as never, frame({ type: "resize", cols: 9999, rows: 24 }));
    expect(t.writes).toEqual([]);
    expect(t.resizes).toEqual([]);
  });

  it("survives a pty that throws", () => {
    const term = {
      write: () => {
        throw new Error("EIO");
      },
    };
    expect(() => handleCommandFrame(term as never, frame({ type: "input", data: "x" }))).not.toThrow();
  });
});

describe("reattachPty", () => {
  it("cancels the pending reap and swaps in the new socket", () => {
    const { reattachPty, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null });
    reattachPty(entry, s.ws as never, SESSION);
    expect(calls).toEqual([`cancelReap:${SESSION}`]);
    expect(entry.ws).toBe(s.ws);
  });

  it("replays the buffered tail so the reattached view has context", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null, buffer: "previous output" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()).toEqual([{ type: "output", data: "previous output" }]);
  });

  it("strips terminal queries from the replay so xterm does not answer them as input", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: null, buffer: "before\x1b[c after" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()[0].data).not.toContain("\x1b[c");
  });

  it("sends nothing when there is no buffered output", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    reattachPty(entryWith({ ws: null, buffer: "" }), s.ws as never, SESSION);
    expect(s.sent).toEqual([]);
  });

  it("tells a superseded socket it lost the session before closing it", () => {
    // Without the notice the kicked client auto-reconnects and the two tabs
    // ping-pong, each reattach kicking the other.
    const { reattachPty } = setup();
    const old = fakeSocket();
    const fresh = fakeSocket();
    const entry = entryWith({ ws: old.ws as never, buffer: "" });
    reattachPty(entry, fresh.ws as never, SESSION);
    expect(old.parsed()).toEqual([{ type: "superseded" }]);
    expect(old.closeCount()).toBe(1);
    expect(entry.ws).toBe(fresh.ws);
  });

  it("does not supersede the same socket reattaching to itself", () => {
    const { reattachPty } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, buffer: "" });
    reattachPty(entry, s.ws as never, SESSION);
    expect(s.parsed()).toEqual([]);
    expect(s.closeCount()).toBe(0);
  });

  it("leaves an already-closed previous socket alone", () => {
    const { reattachPty } = setup();
    const old = fakeSocket(CLOSED);
    const fresh = fakeSocket();
    reattachPty(entryWith({ ws: old.ws as never, buffer: "" }), fresh.ws as never, SESSION);
    expect(old.sent).toEqual([]);
    expect(old.closeCount()).toBe(0);
  });
});

describe("handleClientClose", () => {
  it("detaches the socket and arms the reap", () => {
    const { handleClientClose, calls } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    handleClientClose(entry, s.ws as never, SESSION);
    expect(entry.ws).toBeNull();
    expect(calls).toEqual([`armReap:${SESSION}`]);
  });

  it("clears active, so an unclean disconnect cannot suppress the attention flag", () => {
    // A crashed tab never sends `view active:false`; without this the session would
    // stay "being viewed" until someone reconnects.
    const { handleClientClose } = setup();
    const s = fakeSocket();
    const entry = entryWith({ ws: s.ws as never, active: true });
    handleClientClose(entry, s.ws as never, SESSION);
    expect(entry.active).toBe(false);
  });

  it("ignores the close of a socket a newer client already replaced", () => {
    const { handleClientClose, calls } = setup();
    const current = fakeSocket();
    const stale = fakeSocket();
    const entry = entryWith({ ws: current.ws as never, active: true });
    handleClientClose(entry, stale.ws as never, SESSION);
    expect(entry.ws).toBe(current.ws); // the live socket must survive the old one's close
    expect(entry.active).toBe(true);
    expect(calls).toEqual([]);
  });
});
