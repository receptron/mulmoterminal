// @vitest-environment node
// Which collection a spawned chat is recorded under — the resolution, not the wiring.
//
// The point of resolving SERVER-side is that the caller sends only a name: what a cell ends up
// wearing is what this server found on disk under that name, in the project the session runs in.
// So the cases that matter are the misses — a slash command that is not a collection at all, a
// slug shaped like a path, an engine that threw — each of which must leave a spawn unmarked
// rather than unstarted.
import { describe, it, expect, vi, beforeEach } from "vitest";

const loadCollection = vi.fn();
vi.mock("@mulmoclaude/core/collection/server", () => ({
  loadCollection: (...args: unknown[]) => loadCollection(...args),
  // The real shape, narrowed to what the mark reads. A collection's summary is what the list route
  // already answers with, so this stays the one place the fields are named.
  toSummary: (loaded: { slug: string; schema: { title?: string; icon?: string } }) => ({
    slug: loaded.slug,
    title: loaded.schema.title ?? loaded.slug,
    icon: loaded.schema.icon ?? "",
  }),
}));

const { resolveSpawnCollection } = await import("../../../server/session/spawn-collection.js");

const CWD = "/home/me/proj";
const invoices = { slug: "invoices", schema: { title: "Invoices", icon: "receipt_long" } };

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

  // A schema naming no icon still gets a record: the title is what the mark announces, and the
  // renderer has a fallback glyph.
  it("keeps a collection that declares no icon", async () => {
    loadCollection.mockResolvedValue({ slug: "notes", schema: { title: "Notes" } });
    expect(await resolveSpawnCollection("notes", CWD)).toEqual({ slug: "notes", title: "Notes", icon: "" });
  });
});
