// The placement seam for programmatically started chats: what happens to a spawned session
// depending on whether the grid is mounted. The rules that matter are "never dropped" and
// "never silently placed into a grid the user isn't looking at" — both are how a live agent
// ends up with nowhere to appear.
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, because vi.mock's factory is hoisted above the const it would otherwise close over.
const { push } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));
vi.mock("../../../src/router", () => ({ router: { push } }));

import { placeSpawnedChat, registerSpawnedChatHandler, resetSpawnedChatQueue, type SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const chat = (id: string, over: Partial<SpawnedChatRequest> = {}): SpawnedChatRequest => ({ id, agent: "claude", draft: false, ...over });

describe("placeSpawnedChat", () => {
  beforeEach(() => {
    resetSpawnedChatQueue();
    push.mockClear();
  });

  it("hands the request straight to a registered grid, without navigating", () => {
    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => placed.push(req));

    placeSpawnedChat(chat("a"));

    expect(placed).toEqual([chat("a")]);
    // Already in the grid: a push would re-enter the route the user is on.
    expect(push).not.toHaveBeenCalled();
  });

  it("queues and switches to the grid when none is mounted", () => {
    placeSpawnedChat(chat("a"));

    expect(push).toHaveBeenCalledWith({ name: "terminals" });
  });

  it("drains EVERY queued request in arrival order once the grid registers", () => {
    // A collection action can spawn more than one chat before the route changes; a single
    // slot would report the earlier ones as launched and show neither.
    placeSpawnedChat(chat("a"));
    placeSpawnedChat(chat("b"));

    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => placed.push(req));

    expect(placed.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("carries the agent and the draft flag through, both paths", () => {
    // The agent decides which endpoint the cell reconnects on — a codex session adopted as
    // claude attaches to the wrong one. `draft` means the prompt is waiting in the input box.
    placeSpawnedChat(chat("queued", { agent: "codex", draft: true }));
    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => placed.push(req));
    placeSpawnedChat(chat("direct", { agent: "antigravity" }));

    expect(placed).toEqual([chat("queued", { agent: "codex", draft: true }), chat("direct", { agent: "antigravity" })]);
  });

  it("stops delivering once the grid unregisters, and queues again", () => {
    // GridView drops its handler on deactivate: a chat started from the single view must not
    // silently mutate the cached grid behind it.
    const placed: SpawnedChatRequest[] = [];
    const off = registerSpawnedChatHandler((req) => placed.push(req));
    off();

    placeSpawnedChat(chat("a"));

    expect(placed).toEqual([]);
    expect(push).toHaveBeenCalledWith({ name: "terminals" });
  });

  it("keeps a request queued by a handler that re-enters during the drain", () => {
    // The drain takes the queue BEFORE dispatching, so a handler reaching placeSpawnedChat
    // again (it can, through the grid) does not have its own request cleared underneath it.
    placeSpawnedChat(chat("first"));
    const seen: string[] = [];
    registerSpawnedChatHandler((req) => {
      seen.push(req.id);
      if (req.id === "first") placeSpawnedChat(chat("second"));
    });

    expect(seen).toEqual(["first", "second"]);
  });
});
