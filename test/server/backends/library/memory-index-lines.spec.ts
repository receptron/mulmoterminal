// @vitest-environment node
// The lines of MEMORY.md a delete takes out and an undo puts back (#3331).
import { describe, it, expect } from "vitest";
import { indexLines, withEntryBack, withoutEntry } from "../../../../server/backends/library/memory-index-lines";

describe("indexLines", () => {
  it("keeps each line's own ending, so joining them gives the same text back", () => {
    ["", "a", "a\n", "a\r\nb\rc\nd", "\n\n", "x\r\n"].forEach((text) => expect(indexLines(text).join("")).toBe(text));
    expect(indexLines("a\r\nb\rc")).toEqual(["a\r\n", "b\r", "c"]);
  });
});

describe("withoutEntry", () => {
  it("takes out every line that links to the file, and only those", () => {
    const index = "# Memory\n- [A](a.md) — one\n- [B](b.md) — two\n- also [A again](./a.md)\n";
    expect(withoutEntry(index, "a.md")).toEqual({
      text: "# Memory\n- [B](b.md) — two\n",
      removed: [
        { at: 1, line: "- [A](a.md) — one\n" },
        { at: 3, line: "- also [A again](./a.md)\n" },
      ],
    });
  });
  it("leaves a line that only names the file in prose, or links to another that ends the same", () => {
    const index = "see a.md\n- [X](xa.md)\n- [Y](sub/a.md)\n";
    expect(withoutEntry(index, "a.md")).toEqual({ text: index, removed: [] });
  });
  it("keeps CRLF and a last line with no ending as they were", () => {
    expect(withoutEntry("- [A](a.md)\r\n- [B](b.md)", "a.md")).toEqual({ text: "- [B](b.md)", removed: [{ at: 0, line: "- [A](a.md)\r\n" }] });
    expect(withoutEntry("- [B](b.md)\r\n- [A](a.md)", "a.md").text).toBe("- [B](b.md)\r\n");
  });
  it("gives an empty index back empty", () => {
    expect(withoutEntry("", "a.md")).toEqual({ text: "", removed: [] });
  });
});

describe("withEntryBack", () => {
  const removed = [{ at: 0, line: "- [A](a.md)\n" }];
  it("adds the lines at the end, with the index's own line ending", () => {
    expect(withEntryBack("- [B](b.md)\n", "a.md", removed)).toBe("- [B](b.md)\n- [A](a.md)\n");
    expect(withEntryBack("- [B](b.md)", "a.md", removed)).toBe("- [B](b.md)\n- [A](a.md)\n");
    expect(withEntryBack("- [B](b.md)\r\n", "a.md", [{ at: 0, line: "- [A](a.md)" }])).toBe("- [B](b.md)\r\n- [A](a.md)\r\n");
    expect(withEntryBack("", "a.md", removed)).toBe("- [A](a.md)\n");
  });
  it("adds nothing when the index lists the file again, or nothing was taken out", () => {
    expect(withEntryBack("- [A again](a.md)\n", "a.md", removed)).toBe("- [A again](a.md)\n");
    expect(withEntryBack("- [B](b.md)\n", "a.md", [])).toBe("- [B](b.md)\n");
  });
});
