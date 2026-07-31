// @vitest-environment node
// The SERVER half of the worker-status wire shape. Its sibling — test/common/workerStatus.spec.ts
// — pins the client half and the asymmetry between them.
//
// Split across the two test projects rather than compared in one file, and not for tidiness: a
// spec in the app project that imports a server type pulls node-pty's Node globals into that
// program, and `window.setTimeout` in an unrelated component then resolves to Node's overload and
// fails to compile. The cross-side agreement is carried by both files naming the same shared type.
import { describe, it, expectTypeOf } from "vitest";
import type { WorkerStatus } from "../../../common/workerStatus.js";
import type { SessionMeta } from "../../../server/session/types.js";

describe("worker status — the server's row", () => {
  it("promises both fields, in full", () => {
    // Required on this side: session-reads.ts fills both from the persisted marks on every row, so
    // a row that omitted one would be a bug here rather than an older peer over the wire.
    expectTypeOf<SessionMeta>().toExtend<WorkerStatus>();
    expectTypeOf<SessionMeta["hidden"]>().toEqualTypeOf<boolean>();
    expectTypeOf<SessionMeta["failed"]>().toEqualTypeOf<boolean>();
  });
});
