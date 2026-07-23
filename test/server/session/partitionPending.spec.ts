// @vitest-environment node
import { describe, it, expect } from "vitest";

import { partitionPending } from "../../../server/session/partitionPending.js";
import type { Activity, KnownSession } from "../../../server/session/types.js";

const meta = (title: string, createdAt: number): KnownSession => ({ title, createdAt });

// Default resolvers: nothing active, nothing hidden — isolates the partition decision.
const noActivity = (): Activity | undefined => undefined;
const noneHidden = (): boolean => false;

describe("partitionPending", () => {
  it("routes an id that disk already holds into persisted and never into keep", () => {
    const known: [string, KnownSession][] = [["a", meta("A", 1)]];
    const { keep, persisted } = partitionPending(known, new Set(["a"]), noActivity, noneHidden);
    expect(persisted).toEqual(["a"]);
    expect(keep).toEqual([]);
  });

  it("builds a full pending row for an id that is not on disk", () => {
    const known: [string, KnownSession][] = [["b", meta("Draft", 42)]];
    const { keep, persisted } = partitionPending(known, new Set(), noActivity, noneHidden);
    expect(persisted).toEqual([]);
    expect(keep).toEqual([{ kind: "pending", id: "b", title: "Draft", mtime: 42, working: false, waiting: false, event: null, hidden: false }]);
  });

  it("derives working/waiting/event from the injected activity and hidden from isHidden", () => {
    const activity = new Map<string, Activity>([["b", { working: true, waiting: true, event: "Stop" }]]);
    const hidden = new Set(["b"]);
    const { keep } = partitionPending(
      [["b", meta("Draft", 7)]],
      new Set(),
      (id) => activity.get(id),
      (id) => hidden.has(id),
    );
    expect(keep[0]).toMatchObject({ working: true, waiting: true, event: "Stop", hidden: true });
  });

  it("returns empty keep and persisted for empty known", () => {
    expect(partitionPending([], new Set(["a"]), noActivity, noneHidden)).toEqual({ keep: [], persisted: [] });
  });

  it("puts every id in persisted when they are all on disk", () => {
    const known: [string, KnownSession][] = [
      ["a", meta("A", 1)],
      ["b", meta("B", 2)],
    ];
    const { keep, persisted } = partitionPending(known, new Set(["a", "b"]), noActivity, noneHidden);
    expect(keep).toEqual([]);
    expect(persisted).toEqual(["a", "b"]);
  });

  it("splits a mixed set into keep and persisted", () => {
    const known: [string, KnownSession][] = [
      ["a", meta("A", 1)],
      ["b", meta("B", 2)],
      ["c", meta("C", 3)],
    ];
    const { keep, persisted } = partitionPending(known, new Set(["b"]), noActivity, noneHidden);
    expect(persisted).toEqual(["b"]);
    expect(keep.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("preserves input order in both keep and persisted", () => {
    const known: [string, KnownSession][] = [
      ["k1", meta("1", 1)],
      ["p1", meta("2", 2)],
      ["k2", meta("3", 3)],
      ["p2", meta("4", 4)],
      ["k3", meta("5", 5)],
    ];
    const { keep, persisted } = partitionPending(known, new Set(["p1", "p2"]), noActivity, noneHidden);
    expect(keep.map((r) => r.id)).toEqual(["k1", "k2", "k3"]);
    expect(persisted).toEqual(["p1", "p2"]);
  });

  it("consumes a live Map iterable, not just an array of tuples", () => {
    const known = new Map<string, KnownSession>([
      ["a", meta("A", 1)],
      ["b", meta("B", 2)],
    ]);
    const { keep, persisted } = partitionPending(known, new Set(["a"]), noActivity, noneHidden);
    expect(persisted).toEqual(["a"]);
    expect(keep.map((r) => r.id)).toEqual(["b"]);
  });
});
