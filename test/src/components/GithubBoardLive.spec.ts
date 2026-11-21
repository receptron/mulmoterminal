// The board keeping itself current (#3182): cells follow the `sessions` channel, a card whose cell is
// waiting stands out, and the board reads itself again after a cell on it finishes a turn.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { BoardCard, BoardResponse } from "../../../common/githubBoard";
import { BOARD_POLL_MS, BOARD_TURN_RELOAD_DELAY_MS } from "../../../src/composables/useGithubBoardLive";
import { PTY_OPENED_CHANNEL } from "../../../common/ptyOpenedChannel";

const subscribers = new Map<string, Set<(data: unknown) => void>>();
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      const handlers = subscribers.get(channel) ?? new Set();
      subscribers.set(channel, handlers.add(handler));
      return () => handlers.delete(handler);
    },
    onReconnect: () => () => {},
  }),
}));

const GithubBoard = (await import("../../../src/components/GithubBoard.vue")).default;

const working: BoardCard = {
  key: "branch-feat/x",
  column: "implementing",
  issue: null,
  pr: null,
  branch: "feat/x",
  cells: [{ session: "s1", cwd: "/w/a", working: true, waiting: false }],
};

let boardLoads = 0;
// Set to hold the next board read open until the test releases it.
let holdNextRead: Promise<void> | null = null;
let activitySeeds = 0;
let activitySeed: Record<string, unknown> = {};

beforeEach(() => {
  boardLoads = 0;
  holdNextRead = null;
  activitySeeds = 0;
  activitySeed = {};
  subscribers.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/github/board") {
        boardLoads++;
        const body: BoardResponse = { repos: [{ repo: "o/r", cards: [working] }] };
        const held = holdNextRead;
        holdNextRead = null;
        if (held) await held;
        return new Response(JSON.stringify(body));
      }
      if (url.startsWith("/api/activity")) {
        activitySeeds++;
        return new Response(JSON.stringify(activitySeed));
      }
      return new Response("{}");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const publish = (channel: string, data: unknown): void => subscribers.get(channel)?.forEach((handler) => handler(data));
const push = (data: unknown): void => publish("sessions", data);
const cellCount = (w: { findAll: (selector: string) => unknown[] }): number => w.findAll('[data-testid="board-cell"]').length;

describe("GithubBoard, live", () => {
  it("shows a cell as the channel says it is now, and marks its card as waiting", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    expect(w.find('[data-testid="board-card-waiting"]').exists()).toBe(false);
    push({ id: "s1", working: false, waiting: true });
    await flushPromises();
    expect(w.find('[data-testid="board-card-waiting"]').exists()).toBe(true);
    expect(w.get('[data-testid="board-cell"]').text()).toContain("Waiting for you");
    expect(w.get('[data-testid="board-card"]').classes()).toContain("border-amber");
    w.unmount();
  });

  it("starts from the seeded state of the board's cells", async () => {
    activitySeed = { s1: { working: false, waiting: true } };
    const w = mount(GithubBoard);
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-testid="board-card-waiting"]').exists()).toBe(true);
    w.unmount();
  });

  it("reads the board again shortly after a cell on it finishes a turn, and not before", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    push({ id: "s1", working: true, waiting: false });
    await flushPromises();
    expect(boardLoads).toBe(1);
    push({ id: "s1", working: false, waiting: false });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS - 1);
    expect(boardLoads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(boardLoads).toBe(2);
    w.unmount();
  });

  it("does not read again for a cell that only starts working", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    push({ id: "s1", working: true, waiting: false });
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS * 2);
    expect(boardLoads).toBe(1);
    w.unmount();
  });

  it("reads the board again on its slow tick while the page is visible", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    expect(boardLoads).toBe(2);
    w.unmount();
  });

  it("does not re-seed the cells' state when a reload brings the same cells", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    const seedsAfterMount = activitySeeds;
    expect(seedsAfterMount).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    await flushPromises();
    expect(boardLoads).toBe(2);
    expect(activitySeeds).toBe(seedsAfterMount);
    w.unmount();
  });

  it("keeps the cards on screen when a later read fails", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    await flushPromises();
    expect(w.findAll('[data-testid="board-card"]')).toHaveLength(1);
    expect(w.text()).toContain("Could not read the board.");
    w.unmount();
  });

  it("takes a closed terminal off its card at once, without reading again", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    expect(cellCount(w)).toBe(1);
    push({ id: "s1", working: false, event: "closed" });
    await flushPromises();
    expect(cellCount(w)).toBe(0);
    expect(boardLoads).toBe(1);
    w.unmount();
  });

  it("leaves a card alone for a session that is not on it", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    push({ id: "elsewhere", working: false, event: "closed" });
    await flushPromises();
    expect(cellCount(w)).toBe(1);
    w.unmount();
  });

  it("keeps a closed terminal off when a read sent before the close answers with it", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    let release = (): void => {};
    holdNextRead = new Promise((resolve) => (release = resolve));
    await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    push({ id: "s1", working: false, event: "closed" });
    release();
    await flushPromises();
    expect(boardLoads).toBe(2);
    expect(cellCount(w)).toBe(0);
    w.unmount();
  });

  it("lets go of a close once a read sent after it has answered", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    push({ id: "s1", working: false, event: "closed" });
    await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    await flushPromises();
    expect(boardLoads).toBe(2);
    // The server still listing it after a read that started later means it is alive again.
    expect(cellCount(w)).toBe(1);
    w.unmount();
  });

  it("reads the board again shortly after a terminal opens, once for several", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    publish(PTY_OPENED_CHANNEL, { sessionId: "n1", cwd: "/w/a" });
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS - 1);
    publish(PTY_OPENED_CHANNEL, { sessionId: "n2", cwd: "/w/b" });
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS - 1);
    expect(boardLoads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(boardLoads).toBe(2);
    w.unmount();
  });

  it("ignores an opened frame it cannot read", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    publish(PTY_OPENED_CHANNEL, { sessionId: 7 });
    publish(PTY_OPENED_CHANNEL, null);
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS * 2);
    expect(boardLoads).toBe(1);
    w.unmount();
  });

  it("shows a session again when it opens after closing", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    push({ id: "s1", working: false, event: "closed" });
    await flushPromises();
    publish(PTY_OPENED_CHANNEL, { sessionId: "s1", cwd: "/w/a" });
    await flushPromises();
    expect(cellCount(w)).toBe(1);
    w.unmount();
  });

  it("listens to nothing once the board is closed", async () => {
    const w = mount(GithubBoard);
    await flushPromises();
    w.unmount();
    publish(PTY_OPENED_CHANNEL, { sessionId: "n1", cwd: "/w/a" });
    await vi.advanceTimersByTimeAsync(BOARD_TURN_RELOAD_DELAY_MS * 2);
    expect(boardLoads).toBe(1);
    expect(subscribers.get(PTY_OPENED_CHANNEL)?.size ?? 0).toBe(0);
  });
});
