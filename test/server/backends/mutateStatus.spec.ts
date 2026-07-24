// @vitest-environment node
import { describe, it, expect } from "vitest";

import { mutateStatus, mutateWriteApplied } from "../../../server/backends/mutateStatus.js";

describe("mutateStatus", () => {
  it.each([["view-not-found"], ["item-not-found"]])("answers 404 for the missing target %s", (kind) => {
    expect(mutateStatus(kind)).toBe(404);
  });

  // The branch the old doc comment forgot to mention. It is not a client mistake: no request
  // of any shape succeeds against a dataSource-backed collection, so the caller should stop
  // rather than fix its payload.
  it("answers 405 for a collection that cannot be written at all", () => {
    expect(mutateStatus("read-only-collection")).toBe(405);
  });

  it.each([["not-writable"], ["delete-not-allowed"], ["field-not-editable"], ["path-escape"]])("answers 403 for the policy refusal %s", (kind) => {
    expect(mutateStatus(kind)).toBe(403);
  });

  it.each([["invalid-patch"], ["invalid-id"], ["not-mobile"]])("answers 400 for the malformed request %s", (kind) => {
    expect(mutateStatus(kind)).toBe(400);
  });

  // 405 is the one an unknown kind must not fall into: it tells the client this collection
  // can never be written, which is a much stronger claim than "something went wrong".
  it("answers 400, not 405, for a kind it does not know", () => {
    expect(mutateStatus("brand-new-failure")).toBe(400);
  });

  it("keeps the read-only case distinct from every policy refusal", () => {
    expect(mutateStatus("read-only-collection")).not.toBe(mutateStatus("not-writable"));
  });
});

describe("mutateWriteApplied", () => {
  // Regression (#747): "too-large" means the write APPLIED but its response was oversized —
  // callers must treat it as success (refetch), never a 4xx that shows the edit as failed.
  it("is true only for too-large (an applied write with an oversized response)", () => {
    expect(mutateWriteApplied({ kind: "too-large", bytes: 1 })).toBe(true);
  });

  it("is false for genuine failures and for a plain ok", () => {
    for (const kind of ["ok", "not-writable", "item-not-found", "read-only-collection", "invalid-patch", "path-escape"]) {
      expect(mutateWriteApplied({ kind })).toBe(false);
    }
  });
});
