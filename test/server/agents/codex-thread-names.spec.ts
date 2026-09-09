// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseThreadNameEntry, foldThreadNames, codexHomeOf, readThreadNames, resetThreadNameCache } from "../../../server/agents/codex-thread-names.js";
import { codexSessionsRoot } from "../../../server/agents/codex-session.js";

const UUID_A = "019f251d-001c-7542-b13e-9a627effce52";
const UUID_B = "019db01d-aaa3-7ba2-b597-b29a7fca488f";

const entry = (id: string, name: string, at = "2026-09-09T00:00:00Z"): Record<string, unknown> => ({ id, thread_name: name, updated_at: at });

describe("parseThreadNameEntry", () => {
  it("reads a rename", () => {
    expect(parseThreadNameEntry(entry(UUID_A, "example-name"))).toEqual({ id: UUID_A, name: "example-name" });
  });
  it("trims the recorded name", () => {
    expect(parseThreadNameEntry(entry(UUID_A, "  spaced  "))).toEqual({ id: UUID_A, name: "spaced" });
  });
  it.each([
    ["a blank name", entry(UUID_A, "   ")],
    ["an empty name", entry(UUID_A, "")],
    ["a missing name", { id: UUID_A, updated_at: "x" }],
    ["a missing id", { thread_name: "x" }],
    ["an empty id", entry("", "x")],
    ["a non-string name", { id: UUID_A, thread_name: 7 }],
    ["some other record", { type: "session_meta", payload: { id: UUID_A } }],
  ])("returns null for %s", (_label, doc) => {
    expect(parseThreadNameEntry(doc as Record<string, unknown>)).toBeNull();
  });
});

describe("foldThreadNames", () => {
  it("keeps the last entry for an id — a second /rename wins", () => {
    expect(foldThreadNames([entry(UUID_A, "first"), entry(UUID_B, "other"), entry(UUID_A, "second")])).toEqual(
      new Map([
        [UUID_A, "second"],
        [UUID_B, "other"],
      ]),
    );
  });
  // codex resolves names by ignoring blank entries rather than treating them as a clear; a name is
  // removed by rewriting the file without its lines. So a blank must not erase the name before it.
  it("does not let a blank entry erase an earlier name", () => {
    expect(foldThreadNames([entry(UUID_A, "kept"), entry(UUID_A, "  ")])).toEqual(new Map([[UUID_A, "kept"]]));
  });
  it("is empty for an index with nothing in it", () => {
    expect(foldThreadNames([])).toEqual(new Map());
  });
});

describe("codexHomeOf", () => {
  // The listing gets the SESSIONS root and the index lives one level up, so this derivation is the
  // only thing connecting them. If codexSessionsRoot ever stops being `join(home, "sessions")`,
  // renamed rows go quietly back to showing their first prompt — hence a test rather than a comment.
  it("is the inverse of codexSessionsRoot", () => {
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmpdir(), "codex-home-probe");
    try {
      expect(codexHomeOf(codexSessionsRoot())).toBe(process.env.CODEX_HOME);
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  });
});

describe("readThreadNames", () => {
  let home: string;
  const indexFile = (): string => path.join(home, "session_index.jsonl");
  const writeIndex = (docs: Record<string, unknown>[]): void => writeFileSync(indexFile(), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-codex-names-"));
    resetThreadNameCache();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the names codex recorded", async () => {
    writeIndex([entry(UUID_A, "example-name"), entry(UUID_B, "other")]);
    expect(await readThreadNames(home)).toEqual(
      new Map([
        [UUID_A, "example-name"],
        [UUID_B, "other"],
      ]),
    );
  });

  it("is empty when codex has never written an index", async () => {
    expect(await readThreadNames(home)).toEqual(new Map());
  });

  it("is empty when the index is a directory rather than a file", async () => {
    mkdirSync(indexFile());
    expect(await readThreadNames(home)).toEqual(new Map());
  });

  it("skips malformed and non-object lines rather than losing the rest", async () => {
    writeFileSync(indexFile(), ['{"trunc', "not json", '"a string"', JSON.stringify(entry(UUID_A, "survived")), ""].join("\n"));
    expect(await readThreadNames(home)).toEqual(new Map([[UUID_A, "survived"]]));
  });

  // The file SHRINKS when a name is removed — codex rewrites it without those lines. A reader that
  // resumed from a remembered byte offset would then read from the middle of another line; this one
  // re-folds, so the removal is seen.
  it("sees a name removed by codex rewriting the file", async () => {
    writeIndex([entry(UUID_A, "before"), entry(UUID_B, "kept")]);
    expect(await readThreadNames(home)).toEqual(
      new Map([
        [UUID_A, "before"],
        [UUID_B, "kept"],
      ]),
    );
    writeIndex([entry(UUID_B, "kept")]);
    expect(await readThreadNames(home)).toEqual(new Map([[UUID_B, "kept"]]));
  });

  it("sees a rename appended after an earlier read", async () => {
    writeIndex([entry(UUID_A, "first")]);
    expect(await readThreadNames(home)).toEqual(new Map([[UUID_A, "first"]]));
    writeIndex([entry(UUID_A, "first"), entry(UUID_A, "renamed again")]);
    expect(await readThreadNames(home)).toEqual(new Map([[UUID_A, "renamed again"]]));
  });
});
