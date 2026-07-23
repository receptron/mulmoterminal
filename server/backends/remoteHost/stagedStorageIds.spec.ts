// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { JsonObject } from "@mulmoclaude/core/remote-host";

import { stagedStorageIds } from "./stagedStorageIds.js";

describe("stagedStorageIds", () => {
  it("extracts well-formed ids in order", () => {
    const params: JsonObject = { attachments: [{ storage_id: "a1" }, { storage_id: "b2" }, { storage_id: "c3" }] };
    expect(stagedStorageIds(params)).toEqual(["a1", "b2", "c3"]);
  });

  it("rejects ids that would reshape the Storage path (slash, dot-dot)", () => {
    const params: JsonObject = { attachments: [{ storage_id: "../evil" }, { storage_id: "a/b" }, { storage_id: "ok" }] };
    expect(stagedStorageIds(params)).toEqual(["ok"]);
  });

  it("returns [] when attachments is not an array", () => {
    expect(stagedStorageIds({ attachments: "nope" })).toEqual([]);
    expect(stagedStorageIds({ attachments: 42 })).toEqual([]);
    expect(stagedStorageIds({ attachments: { storage_id: "a1" } })).toEqual([]);
    expect(stagedStorageIds({})).toEqual([]);
  });

  it("skips null, array, and storage_id-less entries without throwing", () => {
    const params: JsonObject = { attachments: [null, ["a1"], {}, { other: "x" }, { storage_id: "keep" }] };
    expect(stagedStorageIds(params)).toEqual(["keep"]);
  });

  it("excludes entries whose storage_id is not a string", () => {
    const params: JsonObject = { attachments: [{ storage_id: 123 }, { storage_id: true }, { storage_id: null }, { storage_id: "keep" }] };
    expect(stagedStorageIds(params)).toEqual(["keep"]);
  });

  it("returns [] for empty attachments", () => {
    expect(stagedStorageIds({ attachments: [] })).toEqual([]);
  });
});
