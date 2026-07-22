// @vitest-environment node
import { describe, it, expect } from "vitest";

import { DOCS_DIR, isDocPath } from "../../../server/backends/docPath.js";

describe("isDocPath", () => {
  it("accepts a document under the documents directory", () => {
    expect(isDocPath(`${DOCS_DIR}/notes.md`)).toBe(true);
  });

  it("accepts the dated path saveNewDoc composes", () => {
    expect(isDocPath(`${DOCS_DIR}/2026/07/design-review-ab12cd34.md`)).toBe(true);
  });

  // This is the only thing keeping an LLM-authored path inside the workspace: the write
  // sites call it and throw on false. The normalization equality is the containment check —
  // a climbing path normalizes to something else and stops here.
  it.each([[`${DOCS_DIR}/../../evil.md`], [`${DOCS_DIR}/a/../../../evil.md`], [`${DOCS_DIR}/x.md/../../../y.md`], [`${DOCS_DIR}/..%2F..%2Fevil.md`]])(
    "refuses the climbing path %s",
    (rel) => {
      expect(isDocPath(rel)).toBe(false);
    },
  );

  it("refuses a path outside the documents directory", () => {
    expect(isDocPath("artifacts/html/page.md")).toBe(false);
    expect(isDocPath("notes.md")).toBe(false);
  });

  // The directory name must be followed by a separator — a sibling directory whose name
  // merely starts the same way is not inside it.
  it("refuses a sibling directory with a matching prefix", () => {
    expect(isDocPath(`${DOCS_DIR}-backup/notes.md`)).toBe(false);
  });

  it("refuses a non-markdown file", () => {
    expect(isDocPath(`${DOCS_DIR}/settings.json`)).toBe(false);
    expect(isDocPath(`${DOCS_DIR}/notes.md.txt`)).toBe(false);
  });

  it("refuses the directory itself", () => {
    expect(isDocPath(DOCS_DIR)).toBe(false);
    expect(isDocPath(`${DOCS_DIR}/`)).toBe(false);
  });

  // Deliberate: there is exactly one way to name a document, so the write guard and the
  // live-refresh matcher can never disagree about whether a given string is that document.
  it("refuses an un-normalized but harmless spelling", () => {
    expect(isDocPath(`${DOCS_DIR}/./notes.md`)).toBe(false);
    expect(isDocPath(`${DOCS_DIR}//notes.md`)).toBe(false);
  });

  it("refuses an empty string", () => {
    expect(isDocPath("")).toBe(false);
  });
});
