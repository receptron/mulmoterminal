import { describe, it, expect } from "vitest";
import { langKindForFilename } from "./cmEditor";

describe("langKindForFilename", () => {
  it("maps markdown extensions", () => {
    expect(langKindForFilename("README.md")).toBe("markdown");
    expect(langKindForFilename("notes.markdown")).toBe("markdown");
    expect(langKindForFilename("doc.MDX")).toBe("markdown");
  });
  it("maps javascript/typescript extensions", () => {
    for (const f of ["a.js", "a.jsx", "a.ts", "a.tsx", "a.mjs", "a.cjs"]) {
      expect(langKindForFilename(f)).toBe("javascript");
    }
  });
  it("maps json", () => {
    expect(langKindForFilename("package.json")).toBe("json");
  });
  it("falls back to text for unknown or extension-less files", () => {
    expect(langKindForFilename("Makefile")).toBe("text");
    expect(langKindForFilename("LICENSE")).toBe("text");
    expect(langKindForFilename("data.csv")).toBe("text");
    expect(langKindForFilename(".gitignore")).toBe("text");
  });
});
