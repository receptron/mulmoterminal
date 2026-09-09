// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveSession, type SessionFacts, resolveReattachableId, canStartLauncher, isContinuingSession } from "../../../server/session/session-resolve.js";

const FIXED = "fresh-minted-id";
const mint = () => FIXED;
const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({ hasLivePty: false, tmuxAlive: false, onDisk: false, cleared: false, ...over });

describe("resolveSession", () => {
  it("mints a fresh id when nothing is requested", () => {
    expect(resolveSession(null, facts(), mint)).toEqual({ reattachId: null, resume: null, sessionId: FIXED });
  });

  it("mints a fresh id when the requested session can't be served (not live, tmux, or on disk)", () => {
    // e.g. reloading an idle session claude never persisted — reusing its id under
    // --session-id would abort, so we start fresh and the browser adopts the new id.
    expect(resolveSession("s1", facts(), mint)).toEqual({ reattachId: null, resume: null, sessionId: FIXED });
  });

  it("reattaches a same-process live pty (no resume, id preserved)", () => {
    expect(resolveSession("s1", facts({ hasLivePty: true }), mint)).toEqual({ reattachId: "s1", resume: null, sessionId: "s1" });
  });

  it("resumes an on-disk transcript", () => {
    expect(resolveSession("s1", facts({ onDisk: true }), mint)).toEqual({ reattachId: null, resume: "s1", sessionId: "s1" });
  });

  // `/clear` leaves OUR key's transcript holding the conversation the user ended (claude took a new
  // id for itself). Resuming it brings that conversation back — and into the next turn's request,
  // which is what made a reboot cost 478k tokens on the first prompt (#2013).
  it("does not resume a transcript the user cleared — it starts fresh", () => {
    expect(resolveSession("s1", facts({ onDisk: true, cleared: true }), mint)).toEqual({ reattachId: null, resume: null, sessionId: FIXED });
  });

  // With tmux holding the session, the claude that attaches is the POST-clear one and the resume
  // arg only covers the window where that tmux session died since we looked. Dropping it there
  // would spawn `--session-id` against an id that is on disk, which claude refuses outright.
  it("still resumes a cleared transcript while tmux is holding the session", () => {
    expect(resolveSession("s1", facts({ onDisk: true, cleared: true, tmuxAlive: true }), mint)).toEqual({
      reattachId: null,
      resume: "s1",
      sessionId: "s1",
    });
  });

  // The mark says nothing about a session this process is already running: that pty IS the
  // post-clear conversation, and reattaching it reads no transcript at all.
  it("reattaches a live pty whether or not the transcript was cleared", () => {
    expect(resolveSession("s1", facts({ hasLivePty: true, onDisk: true, cleared: true }), mint)).toEqual({
      reattachId: "s1",
      resume: null,
      sessionId: "s1",
    });
  });

  it("reuses the id for a live tmux session with no transcript yet (idle, --session-id attaches)", () => {
    expect(resolveSession("s1", facts({ tmuxAlive: true }), mint)).toEqual({ reattachId: null, resume: null, sessionId: "s1" });
  });

  it("resumes an on-disk transcript EVEN when a tmux session is alive (the fix)", () => {
    // Regression: the old logic gated resume on !tmuxAlive, so this yielded resume:null
    // and a --session-id launch that aborts with "already in use" if the tmux session
    // died between the check and the spawn.
    expect(resolveSession("s1", facts({ tmuxAlive: true, onDisk: true }), mint)).toEqual({ reattachId: null, resume: "s1", sessionId: "s1" });
  });

  it("prefers a live pty over tmux/disk", () => {
    expect(resolveSession("s1", facts({ hasLivePty: true, tmuxAlive: true, onDisk: true }), mint)).toEqual({ reattachId: "s1", resume: null, sessionId: "s1" });
  });
});

// /ws/launch and /ws/codex reuse a requested id only when something can actually serve it.
// Handing back an id nothing can serve strands the client on a dead session.
describe("resolveReattachableId", () => {
  const mint = () => "FRESH";
  const facts = (over = {}) => ({ hasLivePty: false, tmuxAlive: false, canResume: false, ...over });

  it("mints a fresh id when nothing was requested", () => {
    expect(resolveReattachableId(null, facts(), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });

  it("reattaches a live pty in this process", () => {
    expect(resolveReattachableId("REQ", facts({ hasLivePty: true }), mint)).toEqual({ reattachId: "REQ", sessionId: "REQ" });
  });

  it("keeps the id for a surviving tmux session, without reattaching a pty", () => {
    expect(resolveReattachableId("REQ", facts({ tmuxAlive: true }), mint)).toEqual({ reattachId: null, sessionId: "REQ" });
  });

  it("keeps the id when there is something to resume", () => {
    expect(resolveReattachableId("REQ", facts({ canResume: true }), mint)).toEqual({ reattachId: null, sessionId: "REQ" });
  });

  it("mints a fresh id when the requested one cannot be served", () => {
    expect(resolveReattachableId("REQ", facts(), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });

  it("prefers the live pty when several facts hold at once", () => {
    expect(resolveReattachableId("REQ", facts({ hasLivePty: true, tmuxAlive: true, canResume: true }), mint)).toEqual({ reattachId: "REQ", sessionId: "REQ" });
  });

  it("never reattaches without a requested id, whatever the facts say", () => {
    expect(resolveReattachableId(null, facts({ hasLivePty: true, tmuxAlive: true, canResume: true }), mint)).toEqual({ reattachId: null, sessionId: "FRESH" });
  });
});

// What the worktree limit asks before refusing a spawn: is this connection creating a session, or
// continuing one? Reading it off the resolved id is the point — Codex caught the first version
// re-listing the ways a session can continue and missing tmux-only liveness, which turns a
// reconnect after a server restart into a "new session" and refuses it (#1208).
describe("isContinuingSession", () => {
  it("is false when nothing was requested", () => {
    expect(isContinuingSession(null, "FRESH")).toBe(false);
  });

  it("is false when the requested id could not be served and a fresh one was minted", () => {
    const { sessionId } = resolveReattachableId("REQ", { hasLivePty: false, tmuxAlive: false, canResume: false }, () => "FRESH");
    expect(isContinuingSession("REQ", sessionId)).toBe(false);
  });

  // The regression: a session that outlived the server exists only in tmux — no live pty, and for
  // codex/antigravity no cold-resume id either, since `tmux new-session -A` reattaches the running
  // program instead.
  it("is true for a tmux-only reattach", () => {
    const { sessionId } = resolveReattachableId("REQ", { hasLivePty: false, tmuxAlive: true, canResume: false }, () => "FRESH");
    expect(isContinuingSession("REQ", sessionId)).toBe(true);
  });

  it("is true for every other way a session continues", () => {
    const mintFresh = () => "FRESH";
    const claude = resolveSession("REQ", facts({ tmuxAlive: true }), mintFresh);
    expect(isContinuingSession("REQ", claude.sessionId)).toBe(true);
    expect(isContinuingSession("REQ", resolveSession("REQ", facts({ hasLivePty: true }), mintFresh).sessionId)).toBe(true);
    expect(isContinuingSession("REQ", resolveSession("REQ", facts({ onDisk: true }), mintFresh).sessionId)).toBe(true);
    expect(isContinuingSession("REQ", resolveReattachableId("REQ", { hasLivePty: false, tmuxAlive: false, canResume: true }, mintFresh).sessionId)).toBe(true);
  });
});

// A launcher connection needs SOMETHING to run: an existing process to reattach to, a
// configured launcher at the requested index, or the "new terminal" shell button.
describe("canStartLauncher", () => {
  const facts = (over = {}) => ({ hasLivePty: false, tmuxAlive: false, hasLauncher: false, isShell: false, ...over });

  it("refuses when there is nothing to reattach and no launcher at that index", () => {
    expect(canStartLauncher(facts())).toBe(false);
  });

  it("allows a reattach even when the index names no launcher", () => {
    // The pty already IS the chosen program, so the index is irrelevant.
    expect(canStartLauncher(facts({ hasLivePty: true }))).toBe(true);
    expect(canStartLauncher(facts({ tmuxAlive: true }))).toBe(true);
  });

  it("allows a fresh spawn of a configured launcher", () => {
    expect(canStartLauncher(facts({ hasLauncher: true }))).toBe(true);
  });

  it("allows the shell button, which has no configured index", () => {
    expect(canStartLauncher(facts({ isShell: true }))).toBe(true);
  });
});
