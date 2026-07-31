// What a spawned chat seeds into its Canvas, and — more importantly — what it does NOT.
// Every collection entry point reaches this through useChatLauncher, so a seed fired for a
// non-collection prompt would put a "not found" card in front of a chat that never mentioned one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { seedCollectionCanvas } from "../../../src/composables/seedCollectionCanvas";
import { PRESENT_COLLECTION_TOOL_NAME } from "../../../common/collectionSeed";

const SESSION = "11111111-1111-1111-1111-111111111111";

/** Records every POSTed toolResult; `collections` is what /api/collections/list answers with. */
function stubFetch(collections: string[], opts: { listOk?: boolean } = {}) {
  const posted: Record<string, unknown>[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/collections/list")) {
      if (opts.listOk === false) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ collections: collections.map((slug) => ({ slug })) }) } as Response;
    }
    if (u.includes("/api/agent/toolResult")) {
      posted.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fn);
  return posted;
}

describe("seedCollectionCanvas", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.unstubAllGlobals());

  it("seeds the collection a chat was started from", async () => {
    const posted = stubFetch(["invoices"]);
    await seedCollectionCanvas(SESSION, "/invoices summarise this quarter");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      sessionId: SESSION,
      toolName: PRESENT_COLLECTION_TOOL_NAME,
      data: { collectionSlug: "invoices" },
      syntheticCollection: true,
    });
  });

  it("seeds the RECORD when the chat was started from one", async () => {
    const posted = stubFetch(["clients"]);
    await seedCollectionCanvas(SESSION, "/clients id=acme-42 fix the address");
    expect(posted[0]).toMatchObject({ data: { collectionSlug: "clients", itemId: "acme-42" } });
  });

  it("seeds nothing for a prompt with no slash command", async () => {
    // The collections index, the template cards, the Settings skill buttons and cron all land here.
    const posted = stubFetch(["invoices"]);
    await seedCollectionCanvas(SESSION, "Set up a new collection for my invoices");
    expect(posted).toEqual([]);
  });

  it("seeds nothing when the slug is not a collection", async () => {
    // `/deep-research …` is a slash command for a SKILL, not a collection. Seeding it would flash
    // a "collection not found" card in a chat that is working perfectly well.
    const posted = stubFetch(["invoices"]);
    await seedCollectionCanvas(SESSION, "/deep-research the market for X");
    expect(posted).toEqual([]);
  });

  it("seeds nothing when the collection list cannot be read", async () => {
    // Skipping costs a slower first paint — the agent presents it anyway. Guessing costs a
    // visible error, so an unreachable list is treated as "unknown", not as "probably fine".
    const posted = stubFetch(["invoices"], { listOk: false });
    await seedCollectionCanvas(SESSION, "/invoices summarise this quarter");
    expect(posted).toEqual([]);
  });

  it("gives each card its own uuid", async () => {
    const posted = stubFetch(["invoices"]);
    await seedCollectionCanvas(SESSION, "/invoices one");
    await seedCollectionCanvas(SESSION, "/invoices two");
    expect(posted[0].uuid).not.toBe(posted[1].uuid);
  });
});
