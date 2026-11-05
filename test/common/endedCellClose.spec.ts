// @vitest-environment node
import { describe, it, expect } from "vitest";
import { shouldCloseEndedCell, STARTUP_WINDOW_MS, type EndedCellExit } from "../../common/endedCellClose";

const ended = (over: Partial<EndedCellExit> = {}): EndedCellExit => ({
  sessionEnded: true,
  lifetimeMs: 60_000,
  reattached: false,
  worktreeCell: false,
  exitCode: 0,
  ...over,
});

describe("shouldCloseEndedCell", () => {
  it("closes an agent cell whose session ended after it had started", () => {
    expect(shouldCloseEndedCell(ended())).toBe(true);
    expect(shouldCloseEndedCell(ended({ lifetimeMs: STARTUP_WINDOW_MS }))).toBe(true);
  });

  // A lost tmux client leaves the agent running; closing on it drops a live session.
  it("keeps the cell when only the pty ended", () => {
    expect(shouldCloseEndedCell(ended({ sessionEnded: false }))).toBe(false);
  });

  // Under tmux a launch failure exits 0 too, so the lifetime is what keeps its banner on screen.
  it("keeps a cell whose agent died inside the startup window", () => {
    expect(shouldCloseEndedCell(ended({ lifetimeMs: STARTUP_WINDOW_MS - 1 }))).toBe(false);
    expect(shouldCloseEndedCell(ended({ lifetimeMs: 0 }))).toBe(false);
  });

  // The lifetime is the reattached pty's, not the agent's: `/exit` right after reopening is an ending.
  it("closes a reattached cell however soon after the attach the agent ended", () => {
    expect(shouldCloseEndedCell(ended({ reattached: true, lifetimeMs: 0 }))).toBe(true);
    expect(shouldCloseEndedCell(ended({ reattached: true, lifetimeMs: null }))).toBe(true);
  });

  it("still needs the session to have ended, and no worktree, when reattached", () => {
    expect(shouldCloseEndedCell(ended({ reattached: true, sessionEnded: false }))).toBe(false);
    expect(shouldCloseEndedCell(ended({ reattached: true, worktreeCell: true }))).toBe(false);
  });

  it("keeps the cell when the frame named no lifetime", () => {
    expect(shouldCloseEndedCell(ended({ lifetimeMs: null }))).toBe(false);
  });

  // A crash stays on screen with its red banner rather than vanishing like `/exit` (#3272).
  it("keeps a cell whose program exited non-zero, however it ended", () => {
    [1, 2, 127, 134, 137, 139, -1].forEach((exitCode) => {
      expect(shouldCloseEndedCell(ended({ exitCode }))).toBe(false);
      expect(shouldCloseEndedCell(ended({ exitCode, reattached: true }))).toBe(false);
    });
  });

  // No code is what an old server's frame, or a malformed one, looks like: decided as before.
  it("decides a frame with no exit code by the other facts alone", () => {
    expect(shouldCloseEndedCell(ended({ exitCode: null }))).toBe(true);
    expect(shouldCloseEndedCell(ended({ exitCode: null, lifetimeMs: 0 }))).toBe(false);
    expect(shouldCloseEndedCell(ended({ exitCode: null, sessionEnded: false }))).toBe(false);
  });

  // Its close asks whether to keep the worktree, which is not asked unprompted.
  it("keeps a worktree cell", () => {
    expect(shouldCloseEndedCell(ended({ worktreeCell: true }))).toBe(false);
  });
});
