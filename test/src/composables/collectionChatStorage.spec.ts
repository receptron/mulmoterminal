// @vitest-environment node
// What survives a reload (#2001).
//
// The chats do already — they are grid cells, and the grid's layout is persisted — but the filing
// was module state, so the collection came back empty while the same agents were still running two
// clicks away. Everything read back here is untrusted JSON from a store the user can edit.
import { describe, it, expect } from "vitest";
import { parseFiledChats, serializeFiledChats } from "../../../src/composables/collectionChatStorage";
import type { CollectionChats } from "../../../src/composables/collectionChatSessions";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const filed = (entries: [string, CollectionChats][]) => new Map(entries);
const chat = (id: string, agent: SpawnedChatRequest["agent"] = "claude"): SpawnedChatRequest => ({ id, agent, draft: false });

describe("the collection chat store", () => {
  it("comes back as it went in", () => {
    const before = filed([["workspace|collection:works", { sessions: [chat("a"), chat("b", "codex")], activeId: "b" }]]);
    expect(parseFiledChats(serializeFiledChats(before))).toEqual(before);
  });

  it("starts empty when there is nothing stored, or nothing readable", () => {
    expect(parseFiledChats(null).size).toBe(0);
    expect(parseFiledChats("").size).toBe(0);
    expect(parseFiledChats("not json").size).toBe(0);
    expect(parseFiledChats("[1,2]").size).toBe(0);
  });

  it("drops a chat with no id, and the collection left with none", () => {
    const stored = JSON.stringify({
      works: { sessions: [{ agent: "claude" }, chat("kept")], activeId: "kept" },
      empty: { sessions: [{ draft: true }], activeId: null },
      broken: { sessions: "nope" },
    });
    const back = parseFiledChats(stored);
    expect([...back.keys()]).toEqual(["works"]);
    expect(back.get("works")?.sessions.map((s) => s.id)).toEqual(["kept"]);
  });

  // An unknown agent reads as claude here, the same coercion a remembered agent gets everywhere
  // else — it decides a label, not a connection.
  it("keeps a chat whose agent it does not recognise", () => {
    const back = parseFiledChats(JSON.stringify({ works: { sessions: [{ id: "a", agent: "wat" }], activeId: "a" } }));
    expect(back.get("works")?.sessions[0]).toEqual({ id: "a", agent: "claude", draft: false });
  });

  // A shown tab that is not in the list leaves the pane pointing at nothing.
  it("falls back to the first chat when the stored active one is not there", () => {
    const back = parseFiledChats(JSON.stringify({ works: { sessions: [chat("a"), chat("b")], activeId: "gone" } }));
    expect(back.get("works")?.activeId).toBe("a");
  });

  it("keeps the draft flag it was given", () => {
    const back = parseFiledChats(JSON.stringify({ works: { sessions: [{ id: "a", agent: "claude", draft: true }], activeId: "a" } }));
    expect(back.get("works")?.sessions[0]?.draft).toBe(true);
  });
});
