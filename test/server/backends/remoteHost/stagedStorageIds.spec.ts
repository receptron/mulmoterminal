// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { JsonObject, JsonValue } from "@mulmoclaude/core/remote-host";

import { stagedStorageIds, STORAGE_ID_RE } from "../../../../server/backends/remoteHost/stagedStorageIds.js";

// The guard that decides which attachment ids get interpolated into a Storage path. Its whole
// job is to keep `/` and `..` out of that path, so a regression fails silently in the worst
// direction: loosen it and a crafted id escapes the storage prefix; tighten it and a legitimate
// attachment just vanishes with no error. Neither shows up until someone inspects the bytes.
const withAttachments = (attachments: JsonValue): JsonObject => ({ attachments });
const staged = (storage_id: JsonValue): JsonObject => withAttachments([{ storage_id }]);

describe("STORAGE_ID_RE", () => {
  it.each(["abc", "ABC123", "a-b-c", "0", "A", "9-9"])("accepts the safe token %j", (id) => {
    expect(STORAGE_ID_RE.test(id)).toBe(true);
  });

  // The two the guard exists for, plus the neighbours a reader might assume are allowed.
  it.each(["..", "a/b", "../etc", "a.b", "a_b", "a b", "a\tb", "café", "", "a\nb"])("rejects the unsafe token %j", (id) => {
    expect(STORAGE_ID_RE.test(id)).toBe(false);
  });

  // Anchored at both ends: a valid core with a traversal prefix/suffix must not match.
  it.each(["../abc", "abc/..", "abc/../def"])("is anchored so %j cannot match on a substring", (id) => {
    expect(STORAGE_ID_RE.test(id)).toBe(false);
  });
});

// Rows wrapped as 1-tuples so a value that is itself an array (a nested-array entry) reaches the
// callback whole, instead of being spread into positional args by it.each.
const nonStringIds: [JsonValue][] = [[42], [true], [null]];
const nonObjectEntries: [JsonValue][] = [[null], ["just-a-string"], [123], [["nested"]]];
const nonArrayAttachments: [JsonValue][] = [["a-string"], [42], [{ nested: "obj" }], [null]];

describe("stagedStorageIds", () => {
  it("keeps every safe id, in order", () => {
    expect(stagedStorageIds(withAttachments([{ storage_id: "aaa" }, { storage_id: "bbb" }, { storage_id: "c-c" }]))).toEqual(["aaa", "bbb", "c-c"]);
  });

  it("returns a single safe id", () => {
    expect(stagedStorageIds(staged("photo-1"))).toEqual(["photo-1"]);
  });

  // The security cases: a path-traversal or slashed id must be dropped, never returned.
  it.each(["..", "../secret", "a/b", "/etc/passwd", "a/../b"])("drops the unsafe id %j", (id) => {
    expect(stagedStorageIds(staged(id))).toEqual([]);
  });

  it("keeps the safe ids and drops the unsafe ones from a mixed list", () => {
    expect(stagedStorageIds(withAttachments([{ storage_id: "ok-1" }, { storage_id: "../bad" }, { storage_id: "ok-2" }, { storage_id: "a/b" }]))).toEqual([
      "ok-1",
      "ok-2",
    ]);
  });

  it("drops an empty-string id (the regex requires at least one char)", () => {
    expect(stagedStorageIds(staged(""))).toEqual([]);
  });

  it.each(nonStringIds)("drops an entry whose storage_id is not a string (%j)", (id) => {
    expect(stagedStorageIds(staged(id))).toEqual([]);
  });

  it("drops an entry with no storage_id field", () => {
    expect(stagedStorageIds(withAttachments([{ other: "x" }]))).toEqual([]);
  });

  it.each(nonObjectEntries)("drops a non-object entry (%j)", (entry) => {
    expect(stagedStorageIds(withAttachments([entry]))).toEqual([]);
  });

  it("is empty when attachments is absent", () => {
    expect(stagedStorageIds({})).toEqual([]);
  });

  it.each(nonArrayAttachments)("is empty when attachments is not an array (%j)", (attachments) => {
    expect(stagedStorageIds(withAttachments(attachments))).toEqual([]);
  });

  it("is empty for an empty attachments array", () => {
    expect(stagedStorageIds(withAttachments([]))).toEqual([]);
  });
});
