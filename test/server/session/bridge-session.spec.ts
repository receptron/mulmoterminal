// @vitest-environment node
//
// Which session a GUI MCP bridge belongs to when nothing told it — the rule muse forces, because a
// plugin's MCP server is started with a curated environment carrying none of ours.
//
// Every path is a proof of DESCENT — under our pane, or under our pty. A shared working directory
// is deliberately not one, and that is the correction Codex's review forced: the plugin is
// machine-wide, so a muse the user started themselves has the bridge too, and a cwd rule would have
// handed it a cell's session id and groups.
//
// The two failure modes this keeps apart: answering the WRONG session (one cell's chart drawn in
// another, or a stranger's process writing under it) and answering NOTHING (no chart). The second
// is the one to prefer — it is the one a user can see and report.
import { describe, it, expect } from "vitest";
import { resolveBridgeSession } from "../../../server/session/bridge-session.js";
import { ancestorPids } from "../../../server/infra/process-tree.js";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

describe("resolveBridgeSession", () => {
  // The measured shape: bridge (2244) -> muse (2220) -> tmux, where 2220 is the pane pid tmux
  // reports for the session named by our own id.
  it("follows the process tree to the pane it is running under", () => {
    const session = resolveBridgeSession({ panePids: new Map([[2220, A]]), ancestors: [2244, 2220, 15746], resolvableSessions: new Map([[A, 999]]) });
    expect(session).toBe(A);
  });

  // The point of walking the TREE: two muse cells opened in one directory are indistinguishable by
  // anything else, and this is what tells them apart.
  it("tells two sessions in one directory apart", () => {
    const facts = {
      panePids: new Map([
        [100, A],
        [200, B],
      ]),
      resolvableSessions: new Map([
        [A, 900],
        [B, 901],
      ]),
    };
    expect(resolveBridgeSession({ ...facts, ancestors: [300, 200] })).toBe(B);
    expect(resolveBridgeSession({ ...facts, ancestors: [301, 100] })).toBe(A);
  });

  // With tmux persistence off there is no pane to match, and there muse is a child of the pty this
  // server spawned — so the pty's own pid is in the chain.
  it("falls back to the pty this server spawned when there is no pane", () => {
    expect(resolveBridgeSession({ panePids: new Map(), ancestors: [4000, 3000], resolvableSessions: new Map([[A, 3000]]) })).toBe(A);
  });

  // THE security case (Codex on #1514). The plugin is machine-wide, so a muse the USER started in
  // a normal terminal has the bridge too. It descends from neither our pane nor our pty, and it
  // must not be handed the session id and groups of a cell that happens to share its directory —
  // it could otherwise draw into that cell's Canvas and write artifacts under its session.
  it("refuses a muse that descends from nothing of ours, even in the same directory", () => {
    const session = resolveBridgeSession({ panePids: new Map([[100, A]]), ancestors: [7001, 7000], resolvableSessions: new Map([[A, 900]]) });
    expect(session).toBeNull();
  });

  it("answers nothing when no muse session is live at all", () => {
    expect(resolveBridgeSession({ panePids: new Map([[100, A]]), ancestors: [101, 100], resolvableSessions: new Map() })).toBeNull();
  });

  // A pane whose session is not a LIVE muse — it ended, or it is a claude cell — must not be
  // claimed by a bridge that happens to sit under it.
  it("ignores a pane whose session is not a live muse session", () => {
    const session = resolveBridgeSession({ panePids: new Map([[2220, "some-claude-session"]]), ancestors: [2244, 2220], resolvableSessions: new Map() });
    expect(session).toBeNull();
  });

  // Nearest ancestor first, so a bridge under a pane inside another session's tree answers the one
  // it actually runs in.
  it("takes the nearest owner in the chain", () => {
    const session = resolveBridgeSession({
      panePids: new Map([[500, B]]),
      ancestors: [600, 500, 400],
      resolvableSessions: new Map([
        [A, 400],
        [B, 901],
      ]),
    });
    expect(session).toBe(B);
  });
});

describe("ancestorPids", () => {
  it("walks from the process up to the root, nearest first", () => {
    const parents = new Map([
      [10, 9],
      [9, 8],
      [8, 1],
    ]);
    expect(ancestorPids(10, (pid) => parents.get(pid) ?? null)).toEqual([10, 9, 8]);
  });

  it("stops at a pid `ps` cannot answer for", () => {
    expect(ancestorPids(10, () => null)).toEqual([10]);
  });

  // A cycle should be impossible, but a walk that trusts `ps` completely would hang the request
  // that started it — and this one runs inside an HTTP handler.
  it("does not spin on a cycle", () => {
    const parents = new Map([
      [10, 11],
      [11, 10],
    ]);
    expect(ancestorPids(10, (pid) => parents.get(pid) ?? null)).toEqual([10, 11]);
  });

  it("is bounded for a very deep tree", () => {
    expect(ancestorPids(1000, (pid) => pid + 1)).toHaveLength(8);
  });
});
