// @vitest-environment node
// A server-started codex is spawned with sandbox grants (#3464), and a cold resume of it must get them
// back: the reconnect that resumes it names none, so they are recorded per session id, on disk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexGrantLine, codexGrantRecord, grantsAnything, NO_CODEX_GRANTS } from "../../../../server/session/spawn/agents/codex-grant-log.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "11111111-2222-4333-8444-666666666666";
const ROOT = path.resolve("/clone/.git/objects");
const isValidSessionId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
const GRANTS = { networkAccess: true, neverAsk: true, writableRoots: [ROOT] };

describe("the codex grant log", () => {
  it("round-trips a record, one line each", () => {
    const line = codexGrantLine({ sessionId: ID, ...GRANTS });
    expect(line).toMatch(/^[^\n]*\n$/);
    expect(codexGrantRecord(JSON.parse(line), isValidSessionId)).toEqual({ sessionId: ID, ...GRANTS });
  });

  it("drops a line with no usable session id, flag or root list", () => {
    for (const parsed of [
      { ...GRANTS, sessionId: "nope" },
      { ...GRANTS, sessionId: 7 },
      { ...GRANTS },
      { sessionId: ID, neverAsk: true, writableRoots: [] },
      { sessionId: ID, networkAccess: "true", neverAsk: true, writableRoots: [] },
      { sessionId: ID, networkAccess: true, neverAsk: 1, writableRoots: [] },
      { sessionId: ID, networkAccess: true, neverAsk: true },
      { sessionId: ID, networkAccess: true, neverAsk: true, writableRoots: ROOT },
      { sessionId: ID, networkAccess: true, neverAsk: true, writableRoots: ["relative/.git"] },
      { sessionId: ID, networkAccess: true, neverAsk: true, writableRoots: [ROOT, 3] },
    ]) {
      expect(codexGrantRecord(parsed, isValidSessionId)).toBeNull();
    }
  });

  it("calls only a grant that widens something a grant", () => {
    expect(grantsAnything(NO_CODEX_GRANTS)).toBe(false);
    expect(grantsAnything({ ...NO_CODEX_GRANTS, networkAccess: true })).toBe(true);
    expect(grantsAnything({ ...NO_CODEX_GRANTS, neverAsk: true })).toBe(true);
    expect(grantsAnything({ ...NO_CODEX_GRANTS, writableRoots: [ROOT] })).toBe(true);
  });
});

describe("codexSessionGrants", () => {
  let home = "";
  const file = () => path.join(home, "codex-session-grants.jsonl");
  const load = async () => {
    vi.resetModules();
    vi.doMock("../../../../server/config/env.js", async (importOriginal) => ({ ...(await importOriginal<object>()), MULMOTERMINAL_HOME: home }));
    const store = await import("../../../../server/session/spawn/agents/codex-session-grants.js");
    await store.codexSessionGrantsHydrated;
    return store;
  };
  const persisted = async () => {
    const { whenSessionStatePersisted } = await import("../../../../server/session/reaping/persist-drain.js");
    await whenSessionStatePersisted();
  };

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "mt-codex-grants-"));
  });
  afterEach(async () => {
    vi.doUnmock("../../../../server/config/env.js");
    await rm(home, { recursive: true, force: true });
  });

  it("grants nothing to a session never spawned with grants, and records nothing for it", async () => {
    const { codexSessionGrants } = await load();
    expect(codexSessionGrants(ID, NO_CODEX_GRANTS)).toEqual(NO_CODEX_GRANTS);
    await persisted();
    await expect(readFile(file(), "utf8")).rejects.toThrow();
  });

  it("keeps the grants asked for, for a later spawn that asks for none", async () => {
    const { codexSessionGrants } = await load();
    expect(codexSessionGrants(ID, GRANTS)).toEqual(GRANTS);
    expect(codexSessionGrants(ID, NO_CODEX_GRANTS)).toEqual(GRANTS);
    expect(codexSessionGrants(OTHER, NO_CODEX_GRANTS)).toEqual(NO_CODEX_GRANTS);
  });

  it("lets a later spawn that asks for other grants replace them", async () => {
    const { codexSessionGrants } = await load();
    codexSessionGrants(ID, GRANTS);
    const narrower = { ...NO_CODEX_GRANTS, networkAccess: true };
    expect(codexSessionGrants(ID, narrower)).toEqual(narrower);
    expect(codexSessionGrants(ID, NO_CODEX_GRANTS)).toEqual(narrower);
  });

  it("survives a restart, and writes one line however often the same grants are asked for", async () => {
    const first = await load();
    first.codexSessionGrants(ID, GRANTS);
    first.codexSessionGrants(ID, { ...GRANTS, writableRoots: [ROOT] });
    await persisted();
    expect((await readFile(file(), "utf8")).trim().split("\n")).toHaveLength(1);
    const restarted = await load();
    expect(restarted.codexSessionGrants(ID, NO_CODEX_GRANTS)).toEqual(GRANTS);
  });

  it("skips a broken line rather than losing the rest", async () => {
    await writeFile(file(), ["not json", JSON.stringify({ sessionId: ID, ...GRANTS }), ""].join("\n"));
    const { codexSessionGrants } = await load();
    expect(codexSessionGrants(ID, NO_CODEX_GRANTS)).toEqual(GRANTS);
  });
});
