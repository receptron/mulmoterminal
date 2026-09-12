// @vitest-environment node
// Which collection a spawned chat is recorded under — the resolution, not the wiring.
//
// The point of resolving SERVER-side is that the caller sends only a name: what a cell ends up
// wearing is what this server found on disk under that name, in the project the session runs in.
// So the cases that matter are the misses — a slash command that is not a collection at all, a
// slug shaped like a path, an engine that threw — each of which must leave a spawn unmarked
// rather than unstarted.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ONLY `loadCollection` is stubbed. `toSummary` is the REAL one, and that is the point: the first
// version of this spec supplied its own `toSummary` with a `?? ""` fallback, and the fallback was
// the thing under test — the real one returns `icon: undefined` for a schema naming no icon, which
// this file swore was handled and was not (Codex round 2). A stub of the function whose OUTPUT
// SHAPE is the risk cannot test that shape.
const loadCollection = vi.fn();
vi.mock("@mulmoclaude/core/collection/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mulmoclaude/core/collection/server")>()),
  loadCollection: (...args: unknown[]) => loadCollection(...args),
}));

const { resolveSpawnCollection } = await import("../../../server/session/spawn-collection.js");
const { sessionCollectionLine, sessionCollectionRecord } = await import("../../../server/session/session-collections.js");
const { asSessionCollection } = await import("../../../common/sessionCollection.js");
const { isSafeSlug } = await import("@mulmoclaude/core/collection");

const SESSION = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

const CWD = "/home/me/proj";
/** What `loadCollection` hands back, in the shape the real `toSummary` reads. */
const loadedAs = (slug: string, schema: Record<string, unknown>) => ({ slug, source: "project", schema });
const invoices = loadedAs("invoices", { title: "Invoices", icon: "receipt_long" });

beforeEach(() => {
  loadCollection.mockReset();
});

describe("resolveSpawnCollection", () => {
  it("answers what the project's own collection says, and asks in that project", async () => {
    loadCollection.mockResolvedValue(invoices);

    expect(await resolveSpawnCollection("invoices", CWD)).toEqual({ slug: "invoices", title: "Invoices", icon: "receipt_long" });
    // The SESSION's directory, not the workspace: two projects can hold a collection of one name,
    // and resolving in the wrong one puts another project's title on the cell.
    expect(loadCollection).toHaveBeenCalledWith("invoices", { workspaceRoot: CWD });
  });

  // `/deep-research …` parses exactly like a collection seed, so the client sends the word and the
  // miss is settled here. Recording nothing is the whole reason it can be sent unchecked.
  it("records nothing for a slug the project has no collection for", async () => {
    loadCollection.mockResolvedValue(null);
    expect(await resolveSpawnCollection("deep-research", CWD)).toBeNull();
  });

  // A FEED is not a collection, and `loadCollection` answers for both — measured:
  // `loadCollection("hacker-news")` returns `source: "feed"` on a workspace that has that feed.
  // The client half already refuses one (`currentCollectionSlug` is null on a feed route), so
  // accepting it here would make a `/hacker-news …` seed mark what browsing to it does not.
  it("records nothing for a feed that shares the name", async () => {
    loadCollection.mockResolvedValue({ ...loadedAs("hacker-news", { title: "Hacker News", icon: "newspaper" }), source: "feed" });
    expect(await resolveSpawnCollection("hacker-news", CWD)).toBeNull();
  });

  // A source this build has never heard of is a miss, not a mark. The rule names what is
  // PERMITTED, so an upstream addition fails closed rather than marking something nobody has
  // decided is a collection.
  it("records nothing for a source it does not recognise", async () => {
    loadCollection.mockResolvedValue({ ...loadedAs("mystery", { title: "Mystery" }), source: "marketplace" });
    expect(await resolveSpawnCollection("mystery", CWD)).toBeNull();
  });

  // Both sources that ARE collections keep working — a user-scope one is as real as a project one.
  it("keeps a user-scope collection", async () => {
    loadCollection.mockResolvedValue({ ...loadedAs("notes", { title: "Notes", icon: "task" }), source: "user" });
    expect(await resolveSpawnCollection("notes", CWD)).toEqual({ slug: "notes", title: "Notes", icon: "task" });
  });

  it("records nothing when no collection was named", async () => {
    expect(await resolveSpawnCollection(null, CWD)).toBeNull();
    expect(await resolveSpawnCollection("", CWD)).toBeNull();
    expect(loadCollection).not.toHaveBeenCalled();
  });

  // Checked before the engine is asked, not only by it: this is the value that becomes a log line
  // and a map key, and the engine's own rule is not this module's to assume.
  it("refuses a slug that is not a collection name, without asking", async () => {
    expect(await resolveSpawnCollection("../../etc/passwd", CWD)).toBeNull();
    expect(await resolveSpawnCollection("a/b", CWD)).toBeNull();
    expect(loadCollection).not.toHaveBeenCalled();
  });

  // A decoration must never take the spawn with it: the user asked for an agent, not for an icon.
  it("answers null when the engine throws", async () => {
    loadCollection.mockRejectedValue(new Error("skills dir is gone"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveSpawnCollection("invoices", CWD)).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  // A schema naming no icon still gets a record. `toSummary` answers `icon: undefined` for it — the
  // key is absent, not empty — and an undefined reaching the store is not cosmetic: JSON.stringify
  // drops it, `sessionCollectionRecord` and `asSessionCollection` both demand a string, and the
  // whole record is discarded. So the collection would lose its TITLE and its mark too.
  it("keeps a collection that declares no icon, as an empty icon", async () => {
    loadCollection.mockResolvedValue(loadedAs("notes", { title: "Notes" }));
    expect(await resolveSpawnCollection("notes", CWD)).toEqual({ slug: "notes", title: "Notes", icon: "" });
  });

  // The same defect on the other optional field, which `toSummary` omits the same way. Fixed as a
  // CLASS rather than at the reported site: `CollectionSummary` declares both `icon: string` and
  // `title: string`, and the runtime keeps neither promise.
  it("falls back to the slug when the schema names no title", async () => {
    loadCollection.mockResolvedValue(loadedAs("notes", { icon: "task" }));
    expect(await resolveSpawnCollection("notes", CWD)).toEqual({ slug: "notes", title: "notes", icon: "task" });
  });

  it("keeps a collection that declares neither", async () => {
    loadCollection.mockResolvedValue(loadedAs("notes", {}));
    expect(await resolveSpawnCollection("notes", CWD)).toEqual({ slug: "notes", title: "notes", icon: "" });
  });

  // And the record it produces has to survive the round trip it is built for — the two guards that
  // silently dropped it before. Asserted here rather than trusted, because "every field is a
  // string" is the whole of what those guards check.
  it("produces a record both the log and the wire accept", async () => {
    loadCollection.mockResolvedValue(loadedAs("notes", {}));
    const resolved = await resolveSpawnCollection("notes", CWD);
    if (!resolved) throw new Error("expected a record"); // narrows, and says what went wrong if it ever does
    const line = sessionCollectionLine({ id: SESSION, ...resolved });
    expect(sessionCollectionRecord(JSON.parse(line), () => true, isSafeSlug)).toEqual({ id: SESSION, slug: "notes", title: "notes", icon: "" });
    expect(asSessionCollection(resolved)).toEqual({ slug: "notes", title: "notes", icon: "" });
  });
});
