// The client side of merging two memories (#3331): what each answer of the route becomes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mergeLibraryMemoryFiles } from "../../../src/composables/libraryApi";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
const REQUEST = { slug: "-w-app", into: "b.md", text: "merged", version: "v-b", from: "a.md", fromVersion: "v-a" };

describe("mergeLibraryMemoryFiles", () => {
  it("posts both memories' versions to the kept one's merge route, and returns its new version and the undo", async () => {
    answer(200, { version: "v-new", undo: "u-1" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "merged", version: "v-new", undo: "u-1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/library/memory/-w-app/b.md/merge");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "merged", version: "v-b", from: "a.md", fromVersion: "v-a" });
  });
  it("names which memory changed on a 409, taking any other answer as the kept one", async () => {
    answer(409, { file: "from" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "from" });
    answer(409, { file: "into" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "into" });
    answer(409, {});
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "into" });
  });
  it("fails on a refusal, a 200 without its fields, or no answer", async () => {
    answer(400, { error: "no" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
    answer(200, { version: "v-new" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
  });
});
