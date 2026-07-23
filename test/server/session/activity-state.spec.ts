import { describe, it, expect } from "vitest";
import {
  buildActivitySnapshot,
  mergeOwnedActivity,
  parseActivityState,
  type PersistedActivity,
  type RestartActivity,
} from "../../../server/session/activity-state.js";

const never = () => false;
const anyId = () => true;

const P = (over: Partial<PersistedActivity> = {}): PersistedActivity => ({ working: false, waiting: false, event: null, ...over });

describe("buildActivitySnapshot", () => {
  it("keeps working OR waiting sessions with their full state, dropping idle ones", () => {
    const entries: Array<[string, RestartActivity]> = [
      ["a", { waiting: true, event: "Notification" }],
      ["b", { working: true, event: "UserPromptSubmit" }],
      ["c", { working: false, waiting: false, event: null }],
    ];
    expect(buildActivitySnapshot(entries, never)).toEqual({
      a: { working: false, waiting: true, event: "Notification" },
      b: { working: true, waiting: false, event: "UserPromptSubmit" },
    });
  });

  it("excludes hidden sessions (translation workers)", () => {
    const entries: Array<[string, RestartActivity]> = [
      ["a", { waiting: true, event: "Stop" }],
      ["hidden", { working: true, event: "x" }],
    ];
    expect(buildActivitySnapshot(entries, (id) => id === "hidden")).toEqual({ a: { working: false, waiting: true, event: "Stop" } });
  });

  it("defaults a missing event to null", () => {
    expect(buildActivitySnapshot([["a", { waiting: true }]], never)).toEqual({ a: { working: false, waiting: true, event: null } });
  });
});

describe("parseActivityState", () => {
  it("parses id -> {working, waiting, event}", () => {
    const raw = { a: { working: false, waiting: true, event: "Stop" }, b: { working: true, waiting: false, event: null } };
    expect(parseActivityState(raw, anyId)).toEqual([
      { id: "a", working: false, waiting: true, event: "Stop" },
      { id: "b", working: true, waiting: false, event: null },
    ]);
  });

  it("drops ids that fail validation and non-object entries", () => {
    const raw = { good: { waiting: true, event: "Stop" }, "../bad": { waiting: true }, x: "nope" };
    expect(parseActivityState(raw, (id) => id === "good")).toEqual([{ id: "good", working: false, waiting: true, event: "Stop" }]);
  });

  it("coerces missing/invalid fields to false/null", () => {
    expect(parseActivityState({ a: { event: 5 } }, anyId)).toEqual([{ id: "a", working: false, waiting: false, event: null }]);
  });

  it("returns [] for non-object input", () => {
    expect(parseActivityState(null, anyId)).toEqual([]);
    expect(parseActivityState("x", anyId)).toEqual([]);
  });
});

// Two servers rooted at the same MULMOTERMINAL_HOME share this file. A persist must rewrite
// only the sessions THIS instance owns and leave the other instance's alone — otherwise a
// full-snapshot overwrite drops or revives the other's sessions (the #672 cross-process bug).
describe("mergeOwnedActivity", () => {
  const ownedBy =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);

  it("writes this instance's owned entries and preserves another instance's", () => {
    const onDisk = { a1: P({ working: true }), b1: P({ waiting: true, event: "Notification" }) };
    const owned = { a1: P({ waiting: true, event: "Stop" }) };
    // a1 is ours (updated); b1 belongs to the other instance (left as-is on disk).
    expect(mergeOwnedActivity(onDisk, owned, ownedBy("a1"))).toEqual({
      a1: P({ waiting: true, event: "Stop" }),
      b1: P({ waiting: true, event: "Notification" }),
    });
  });

  it("does not drop the other instance's session when ours goes idle", () => {
    // ours (a1) went idle so it's absent from `owned`; the other instance's b1 must survive.
    expect(mergeOwnedActivity({ a1: P({ working: true }), b1: P({ waiting: true }) }, {}, ownedBy("a1"))).toEqual({
      b1: P({ waiting: true }),
    });
  });

  it("removes an owned session that is no longer active, even if still stale on disk", () => {
    // a1 is ours and reaped: gone from `owned`, but a stale entry lingers on disk. Ours wins.
    expect(mergeOwnedActivity({ a1: P({ working: true }) }, {}, ownedBy("a1"))).toEqual({});
  });

  it("does not revive an owned session from disk — this instance is authoritative for its ids", () => {
    // disk says a1 working (a stale write), but we own it and know it's idle now.
    expect(mergeOwnedActivity({ a1: P({ working: true }) }, { a1: P({ working: false, waiting: false }) }, ownedBy("a1"))).toEqual({
      a1: P({ working: false }),
    });
  });

  it("keeps foreign entries untouched when we own nothing", () => {
    const onDisk = { b1: P({ working: true }), c1: P({ waiting: true }) };
    expect(mergeOwnedActivity(onDisk, {}, never)).toEqual(onDisk);
  });
});
