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

  // buildDocPath reads the LOCAL calendar (getFullYear/getMonth), because a document written at
  // 16:00 on Feb 28 in California belongs in its author's /02/, not in /03/ because it was
  // already past midnight in London. So the fixtures have to be built in local time too.
  //
  // `new Date("2026-03-01T00:00:00Z")` does NOT mean "March 1st" — it is an instant, and midnight
  // UTC on the 1st is still the PREVIOUS month everywhere west of Greenwich. Written that way,
  // this suite passed in CI (UTC) and failed on a developer machine in US/Pacific.
  //
  // Month is 1-based here; Date's own argument is not, which is the other half of the trap.
  const localDate = (year: number, month: number, day: number) => new Date(year, month - 1, day);

  it("composes a dated path under the documents directory", () => {
    expect(buildDocPath("notes", localDate(2026, 7, 23), rand)).toBe(`${DOCS_DIR}/2026/07/notes-${rand}.md`);
  });

  it("zero-pads the month", () => {
    expect(buildDocPath("x", localDate(2026, 3, 1), rand)).toContain("/2026/03/");
  });

  // The whole chain: whatever the title, the result is a path isDocPath will accept — which
  // is what keeps the write inside the workspace and lets the saved doc load afterwards.
  it.each([["../../escape"], ["foo/bar"], [""], ["!!!"], ["a".repeat(200)]])("always produces a path isDocPath accepts, for %j", (title) => {
    expect(isDocPath(buildDocPath(title, localDate(2026, 7, 23), rand))).toBe(true);
  });

  // The above only prove the fixtures are right on THIS machine. Since the whole defect was a
  // clock the suite never controlled, drive the real function under both extremes: a date is
  // filed by its local calendar or not, and either way every machine has to agree.
  describe("files by the local calendar, wherever the machine is", () => {
    function underTz<T>(tz: string, fn: () => T): T {
      const before = process.env.TZ;
      process.env.TZ = tz;
      try {
        return fn();
      } finally {
        // Restore rather than delete: a TZ this process inherited must survive the test.
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      }
    }

    // UTC-14 through UTC+14 — the two ends that a UTC-only CI can never exercise.
    it.each([["Pacific/Midway"], ["Pacific/Kiritimati"], ["UTC"]])("puts a local March 1st under /2026/03/ in %s", (tz) => {
      expect(underTz(tz, () => buildDocPath("x", localDate(2026, 3, 1), rand))).toContain("/2026/03/");
    });

    // The converse, stated as the behaviour rather than an accident: the same INSTANT is filed
    // under different months by design, because the two authors are on different days.
    it("files one instant by each author's own month", () => {
      const midnightUtcMar1 = new Date("2026-03-01T00:00:00Z");
      expect(underTz("America/Los_Angeles", () => buildDocPath("x", midnightUtcMar1, rand))).toContain("/2026/02/");
      expect(underTz("Asia/Tokyo", () => buildDocPath("x", midnightUtcMar1, rand))).toContain("/2026/03/");
    });
  });
});
