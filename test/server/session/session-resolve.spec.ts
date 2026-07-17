import { describe, it, expect } from "vitest";
import { resolveSession, type SessionFacts } from "../../../server/session/../../server/session/session-resolve.js";

const FIXED = "fresh-minted-id";
const mint = () => FIXED;
const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({ hasLivePty: false, tmuxAlive: false, onDisk: false, ...over });

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
