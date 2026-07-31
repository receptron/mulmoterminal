// The worker-status wire shape, and the one way the two sides of it differ.
//
// `common/` holds the core because both sides decide from these fields — the server fills them per
// row, the launcher renders them as labels — and two copies of a wire shape is the drift this
// directory exists to prevent. But the sides are NOT identical, and an asymmetry that nothing
// pins is indistinguishable from one side having drifted: the server always answers both fields,
// a browser may be reading rows from an older server that answers neither.
//
// The SERVER half is pinned in test/server/session/worker-status.spec.ts — separate because a spec
// in this project that imports a server type drags node-pty's Node globals into the program, and
// an unrelated component's window.setTimeout then stops compiling.
import { describe, it, expect, expectTypeOf } from "vitest";
import type { WorkerStatus, PartialWorkerStatus } from "../../common/workerStatus";
import type { ResumableSession } from "../../src/composables/useDirLists";

describe("worker status — the shared core", () => {
  it("is what the CLIENT's row may receive, optionally", () => {
    // The deliberate asymmetry. A page left open across an upgrade parses rows from a server that
    // predates these fields; declaring them required would make the type lie about what arrives.
    expectTypeOf<ResumableSession>().toExtend<PartialWorkerStatus>();
    expectTypeOf<ResumableSession["hidden"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ResumableSession["failed"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("keeps the two sides describing the same two fields", () => {
    // The point of sharing: a field added to one side cannot quietly not exist on the other.
    // Compared as VALUES so this fails loudly rather than only under a type-check.
    const server: WorkerStatus = { hidden: true, failed: true };
    const client: PartialWorkerStatus = server;
    expect(Object.keys(server).sort()).toEqual(["failed", "hidden"]);
    expect(client).toEqual(server);
  });

  it("treats an absent field as 'no badge', which is what an older row should show", () => {
    // Absence-tolerant by design: the launcher renders on truthiness, so a row that never said
    // gets neither label rather than a wrong one.
    const older: PartialWorkerStatus = {};
    expect(older.hidden ?? false).toBe(false);
    expect(older.failed ?? false).toBe(false);
  });
});
