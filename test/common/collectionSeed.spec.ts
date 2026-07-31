// Parsing a collection chat seed, and the rule that keeps a placeholder card and the agent's real
// one from stacking. Both sides of the app decide from these, so they are pinned here once rather
// than through either caller.
import { describe, it, expect } from "vitest";
import {
  parseCollectionSlashSeed,
  makeSyntheticCollectionResult,
  reconcileCollectionCard,
  isSyntheticCollection,
  PRESENT_COLLECTION_TOOL_NAME,
} from "../../common/collectionSeed";

const real = (uuid: string, collectionSlug: string) => ({
  uuid,
  toolName: PRESENT_COLLECTION_TOOL_NAME,
  data: { collectionSlug },
});

describe("parseCollectionSlashSeed", () => {
  it("reads the collection out of a plain seed", () => {
    expect(parseCollectionSlashSeed("/invoices summarise this quarter")).toEqual({ slug: "invoices" });
  });

  it("reads the record out of an id= seed", () => {
    // The `id=` selector comes BEFORE the prose so the skill's parser reads it as a flag —
    // skillCommandSeed builds it that way, and this is the half that reads it back.
    expect(parseCollectionSlashSeed("/clients id=acme-42 fix the address")).toEqual({ slug: "clients", itemId: "acme-42" });
  });

  it("tolerates leading whitespace and a bare slug", () => {
    expect(parseCollectionSlashSeed("   /todo")).toEqual({ slug: "todo" });
  });

  it("returns null for prose, which is how feeds and template cards seed nothing", () => {
    // A feed's seed names a data path instead of a slash command; the index, the template cards,
    // the Settings skill buttons and cron send prose too. No case per caller — they all land here.
    expect(parseCollectionSlashSeed("Look at data/feeds/news and tell me what changed")).toBeNull();
    expect(parseCollectionSlashSeed("")).toBeNull();
  });

  it("refuses a path-like slug, so a file path is never mistaken for a collection", () => {
    expect(parseCollectionSlashSeed("/Users/me/notes.md what is this")).toBeNull();
    expect(parseCollectionSlashSeed("/ leading space then prose")).toBeNull();
  });
});

describe("makeSyntheticCollectionResult", () => {
  it("carries only the addressing — the View self-fetches from the slug", () => {
    const card = makeSyntheticCollectionResult("u-1", "invoices", "inv-9");
    expect(card.toolName).toBe(PRESENT_COLLECTION_TOOL_NAME);
    // Both fields: the panel reads `data`, and a partial view-state update may carry only jsonData.
    expect(card.data).toEqual({ collectionSlug: "invoices", itemId: "inv-9" });
    expect(card.jsonData).toEqual({ collectionSlug: "invoices", itemId: "inv-9" });
    expect(isSyntheticCollection(card)).toBe(true);
  });

  it("omits itemId entirely when the seed named no record", () => {
    // Not `itemId: undefined` — the payload is sent as JSON and read by the shared View.
    expect(makeSyntheticCollectionResult("u-2", "invoices").data).toEqual({ collectionSlug: "invoices" });
  });
});

describe("reconcileCollectionCard", () => {
  it("drops the placeholder when the agent's real card for that collection arrives", () => {
    const list = [makeSyntheticCollectionResult("seed", "invoices")];
    expect(reconcileCollectionCard(list, real("agent", "invoices"))).toBe("store");
    expect(list).toEqual([]); // the real one is appended by the caller, in the placeholder's place
  });

  it("skips a placeholder that the real card has already beaten", () => {
    // The race this exists for: our validation fetch is slower than the agent's first tool call.
    // Storing now would leave a duplicate nothing later removes — the supersede above has already
    // run and found nothing.
    const list = [real("agent", "invoices")];
    expect(reconcileCollectionCard(list, makeSyntheticCollectionResult("seed", "invoices"))).toBe("skip");
    expect(list).toHaveLength(1);
  });

  it("leaves a placeholder for a DIFFERENT collection alone", () => {
    const list = [makeSyntheticCollectionResult("seed", "invoices")];
    expect(reconcileCollectionCard(list, real("agent", "clients"))).toBe("store");
    expect(list).toHaveLength(1);
  });

  it("passes every other tool through untouched", () => {
    // Safe to run over EVERY result, which is why the callers don't pre-filter.
    const list = [makeSyntheticCollectionResult("seed", "invoices")];
    expect(reconcileCollectionCard(list, { uuid: "x", toolName: "presentChart", data: { a: 1 } })).toBe("store");
    expect(reconcileCollectionCard(list, { uuid: "y" })).toBe("store");
    expect(list).toHaveLength(1);
  });

  it("stores two real cards for one collection rather than folding them", () => {
    // Only the PLACEHOLDER is superseded. A second real presentCollection is the agent choosing to
    // present again, and collapsing that would be a behaviour change nothing here asked for.
    const list = [real("first", "invoices")];
    expect(reconcileCollectionCard(list, real("second", "invoices"))).toBe("store");
    expect(list).toHaveLength(1);
  });
});
