// The client side of merging two memories (#3331): what each answer of the route becomes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadLibraryMemoryLinks, mergeLibraryMemoryFiles } from "../../../src/composables/libraryApi";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
const REQUEST = { slug: "-w-app", into: "b.md", text: "merged", version: "v-b", from: "a.md", fromVersion: "v-a" };

describe("mergeLibraryMemoryFiles", () => {
  it("posts both memories' versions to the kept one's merge route, and returns the text written, its version, the links and the undo", async () => {
    answer(200, { version: "v-new", undo: "u-1", text: "merged [[b]]", links: 2 });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "merged", version: "v-new", undo: "u-1", text: "merged [[b]]", links: 2 });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/library/memory/-w-app/b.md/merge");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "merged", version: "v-b", from: "a.md", fromVersion: "v-a" });
  });
  it("names which memory changed on a 409, taking any other answer as the kept one", async () => {
    answer(409, { file: "from" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "from" });
    answer(409, { file: "into" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "into" });
    answer(409, { file: "links" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "links" });
    answer(409, {});
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "changed", file: "into" });
  });
  it("names the memories whose links could not be rewritten on a 422", async () => {
    answer(422, { files: ["c.md", 3, "d.md"] });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "unplaceable", files: ["c.md", "d.md"] });
    answer(422, {});
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "unplaceable", files: [] });
  });
  it("fails on a refusal, a 200 without its fields, or no answer", async () => {
    answer(400, { error: "no" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
    answer(200, { version: "v-new" });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
    answer(200, { version: "v-new", undo: "u-1", links: 1 });
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await mergeLibraryMemoryFiles(REQUEST)).toEqual({ kind: "failed" });
  });
});

describe("loadLibraryMemoryLinks", () => {
  it("asks the kept memory's links route about the one merged in, and reads the count", async () => {
    answer(200, { count: 3, unplaceable: ["e.md"] });
    expect(await loadLibraryMemoryLinks("-w-app", "b.md", "a b.md")).toEqual({ count: 3, unplaceable: ["e.md"] });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/library/memory/-w-app/b.md/links?from=a%20b.md");
    answer(404, {});
    expect(await loadLibraryMemoryLinks("-w-app", "b.md", "a.md")).toBeNull();
  });
});
