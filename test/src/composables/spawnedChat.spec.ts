// The placement seam for programmatically started chats: what happens to a spawned session
// depending on whether the grid is mounted. The rules that matter are "never dropped" and
// "never silently placed into a grid the user isn't looking at" — both are how a live agent
// ends up with nowhere to appear.
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, because vi.mock's factory is hoisted above the const it would otherwise close over.
// `currentRoute` as well as `push`: placing now asks where the user IS before navigating, because
// a mounted grid is not necessarily a visible one (it survives under a full-screen overlay).
const { push, routeName } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()), routeName: { value: "terminals" as string } }));
vi.mock("../../../src/router", () => ({
  router: {
    push,
    currentRoute: {
      get value() {
        return { name: routeName.value };
      },
    },
  },
}));

import { placeSpawnedChat, registerSpawnedChatHandler, resetSpawnedChatQueue, type SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const chat = (id: string, over: Partial<SpawnedChatRequest> = {}): SpawnedChatRequest => ({ id, agent: "claude", draft: false, canvas: false, ...over });

describe("placeSpawnedChat", () => {
  beforeEach(() => {
    resetSpawnedChatQueue();
    push.mockClear();
    routeName.value = "terminals"; // the usual case: the user is looking at the grid
  });

  it("hands the request straight to a registered grid, without navigating", () => {
    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));

    placeSpawnedChat(chat("a"));

    expect(placed).toEqual([chat("a")]);
    // Already in the grid: a push would re-enter the route the user is on.
    expect(push).not.toHaveBeenCalled();
  });

  // The grid survives under a full-screen overlay (#1190), so it can take the chat while the user
  // is still looking at the collections browser. Placing it is not enough — before the grid stayed
  // mounted, the queue-and-navigate path closed that overlay by accident, and the chat became
  // invisible the moment that stopped happening.
  it("switches to the grid even when a mounted one took the request", () => {
    routeName.value = "collections";
    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));

    placeSpawnedChat(chat("a"));

    expect(placed).toEqual([chat("a")]);
    expect(push).toHaveBeenCalledWith({ name: "terminals" });
  });

  it("queues and switches to the grid when none is mounted", () => {
    routeName.value = "chat";
    placeSpawnedChat(chat("a"));

    expect(push).toHaveBeenCalledWith({ name: "terminals" });
  });

  // Codex, on PR #1193. A FULL grid refuses the chat and falls back to showing it in the single
  // view. Pushing to /terminals then would drag the user off the view the session just appeared
  // in — the navigation added for overlays must not override the fallback that predates it.
  it("does NOT switch to the grid when a full grid refused the chat", () => {
    routeName.value = "collections";
    registerSpawnedChatHandler(() => false); // MAX_TERMINALS: shown in the single view instead

    placeSpawnedChat(chat("a"));

    expect(push).not.toHaveBeenCalled();
  });

  it("drains EVERY queued request in arrival order once the grid registers", () => {
    // A collection action can spawn more than one chat before the route changes; a single
    // slot would report the earlier ones as launched and show neither.
    placeSpawnedChat(chat("a"));
    placeSpawnedChat(chat("b"));

    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));

    expect(placed.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("carries the agent and the draft flag through, both paths", () => {
    // The agent decides which endpoint the cell reconnects on — a codex session adopted as
    // claude attaches to the wrong one. `draft` means the prompt is waiting in the input box.
    placeSpawnedChat(chat("queued", { agent: "codex", draft: true }));
    const placed: SpawnedChatRequest[] = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));
    placeSpawnedChat(chat("direct", { agent: "antigravity" }));

    expect(placed).toEqual([chat("queued", { agent: "codex", draft: true }), chat("direct", { agent: "antigravity" })]);
  });

  it("stops delivering once the grid unregisters, and queues again", () => {
    // GridView drops its handler on deactivate: a chat started from the single view must not
    // silently mutate the cached grid behind it.
    const placed: SpawnedChatRequest[] = [];
    const off = registerSpawnedChatHandler((req) => (placed.push(req), true));
    off();

    routeName.value = "chat";
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
      return true;
    });

    expect(seen).toEqual(["first", "second"]);
  });
});
