// @vitest-environment node
import { describe, it, expect } from "vitest";

import { buildDocPath, DOCS_DIR, isDocPath, sanitizeDocPrefix } from "../../../server/backends/docPath.js";

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

describe("sanitizeDocPrefix", () => {
  it("keeps a plain title as one lowercase segment", () => {
    expect(sanitizeDocPrefix("Design Review")).toBe("design-review");
  });

  // The security property: a model-authored title must never contribute a path separator.
  it.each([
    ["../../etc/passwd", "etc-passwd"],
    ["foo/bar", "foo-bar"],
    ["a\\b", "a-b"],
    ["x/../../y", "x-y"],
  ])("collapses %j to a single segment with no separators", (input, expected) => {
    const out = sanitizeDocPrefix(input);
    expect(out).not.toMatch(/[/\\]/);
    expect(out).not.toContain("..");
    expect(out).toBe(expected);
  });

  it("collapses a run of unsafe characters to one dash", () => {
    expect(sanitizeDocPrefix("a   !!!   b")).toBe("a-b");
  });

  it("trims a leading and trailing dash", () => {
    expect(sanitizeDocPrefix("!hello!")).toBe("hello");
    expect(sanitizeDocPrefix("///only-slashes///")).toBe("only-slashes");
  });

  // Without the fallback, a title of only unsafe characters would leave a filename starting
  // with the random suffix's dash.
  it.each([[""], ["   "], ["!!!"], ["/"], ["....."]])("falls back to 'document' for %j", (input) => {
    expect(sanitizeDocPrefix(input)).toBe("document");
  });

  it("caps the length at 60 characters", () => {
    expect(sanitizeDocPrefix("a".repeat(200))).toHaveLength(60);
  });

  // The cap slices AFTER the trim, so a boundary landing at position 60 can leave a trailing
  // dash. Harmless — it is one segment either way, and buildDocPath appends `-<rand>` so the
  // filename is still valid — but pinned so a future "tidy the trailing dash" change is a
  // deliberate one, not an accident.
  it("may keep a trailing dash when the cap lands on a boundary", () => {
    expect(sanitizeDocPrefix("a".repeat(59) + " tail")).toBe("a".repeat(59) + "-");
  });
});

describe("buildDocPath", () => {
  const rand = "ab12cd34";

  it("composes a dated path under the documents directory", () => {
    expect(buildDocPath("notes", new Date("2026-07-23T00:00:00Z"), rand)).toBe(`${DOCS_DIR}/2026/07/notes-${rand}.md`);
  });

  it("zero-pads the month", () => {
    expect(buildDocPath("x", new Date("2026-03-01T00:00:00Z"), rand)).toContain("/2026/03/");
  });

  // The whole chain: whatever the title, the result is a path isDocPath will accept — which
  // is what keeps the write inside the workspace and lets the saved doc load afterwards.
  it.each([["../../escape"], ["foo/bar"], [""], ["!!!"], ["a".repeat(200)]])("always produces a path isDocPath accepts, for %j", (title) => {
    expect(isDocPath(buildDocPath(title, new Date("2026-07-23T00:00:00Z"), rand))).toBe(true);
  });
});
