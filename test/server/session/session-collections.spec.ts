// @vitest-environment node
import { describe, it, expect } from "vitest";

import { applySessionCollection, sessionCollectionLine, sessionCollectionRecord } from "../../../server/session/session-collections.js";
import type { SessionCollection } from "../../../common/sessionCollection.js";

const VALID_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const OTHER_ID = "1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901";
const isValidId = (id: string) => id === VALID_ID || id === OTHER_ID;
const isValidSlug = (slug: string) => /^[a-z0-9_-]+$/i.test(slug);

// What hydration does: parse each line, keep the last one for each id.
const collectionsFrom = (lines: string[]): Map<string, SessionCollection> => {
  const collections = new Map<string, SessionCollection>();
  lines.forEach((line) => {
    const record = sessionCollectionRecord(JSON.parse(line), isValidId, isValidSlug);
    if (record) applySessionCollection(collections, record);
  });
  return collections;
};

const INVOICES = { slug: "invoices", icon: "receipt_long", title: "Invoices" };

describe("sessionCollectionLine", () => {
  it("writes one JSON object per line", () => {
    const line = sessionCollectionLine({ id: VALID_ID, ...INVOICES });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ id: VALID_ID, ...INVOICES });
  });

  // A title is whatever the collection's schema says, and an icon may be an emoji: both go through
  // JSON so a quote, a backslash or an astral code point cannot shape the file.
  it("survives a round trip through quotes, backslashes and an emoji icon", () => {
    const awkward = { slug: "notes", icon: "🗒️", title: 'C:\\notes — "検証"' };
    expect(collectionsFrom([sessionCollectionLine({ id: VALID_ID, ...awkward })]).get(VALID_ID)).toEqual(awkward);
  });
});

describe("hydrating a session-collection log", () => {
  it("takes the newest line for an id", () => {
    const lines = [sessionCollectionLine({ id: VALID_ID, ...INVOICES }), sessionCollectionLine({ id: VALID_ID, slug: "tasks", icon: "task", title: "Tasks" })];
    expect(collectionsFrom(lines).get(VALID_ID)?.slug).toBe("tasks");
  });

  it("keeps each session's own answer", () => {
    const lines = [sessionCollectionLine({ id: VALID_ID, ...INVOICES }), sessionCollectionLine({ id: OTHER_ID, slug: "tasks", icon: "task", title: "Tasks" })];
    const collections = collectionsFrom(lines);
    expect([collections.get(VALID_ID)?.slug, collections.get(OTHER_ID)?.slug]).toEqual(["invoices", "tasks"]);
  });
});

describe("sessionCollectionRecord", () => {
  it("rejects an id the server does not recognise", () => {
    expect(sessionCollectionRecord({ id: "../../etc", ...INVOICES }, isValidId, isValidSlug)).toBeNull();
  });

  // The slug is checked on the way IN as well as on the way out: a hand-edited line, or one from a
  // build whose rule was looser, must not put a path where a collection name goes.
  it("rejects a slug that is not a collection name", () => {
    expect(sessionCollectionRecord({ id: VALID_ID, slug: "../secrets", icon: "task", title: "Tasks" }, isValidId, isValidSlug)).toBeNull();
  });

  it("rejects a half-written record rather than showing part of one", () => {
    expect(sessionCollectionRecord({ id: VALID_ID, slug: "invoices" }, isValidId, isValidSlug)).toBeNull();
    expect(sessionCollectionRecord({ id: VALID_ID, slug: "invoices", icon: 3, title: "Invoices" }, isValidId, isValidSlug)).toBeNull();
  });

  // "" is what `toSummary` answers for a schema that names no icon, and it is a value rather than a
  // miss: IconGlyph falls back for it, and dropping the record would lose the title too.
  it("keeps a record whose collection declares no icon", () => {
    expect(sessionCollectionRecord({ id: VALID_ID, slug: "invoices", icon: "", title: "Invoices" }, isValidId, isValidSlug)).toEqual({
      id: VALID_ID,
      slug: "invoices",
      icon: "",
      title: "Invoices",
    });
  });
});
