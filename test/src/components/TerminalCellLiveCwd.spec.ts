import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import type { ConnHandlers } from "../../../src/composables/useTerminalConnections";

// The seam the other TerminalCell specs cannot reach: they stub Terminal.vue, so they prove the
// CELL reacts to a `live-cwd` event, never that the real Terminal emits one. Here Terminal.vue is
// real and only the connection manager is faked, so the chain under test is
//   manager handler -> Terminal.vue emit -> TerminalCell listener -> header.
// Every link in that chain shipped untested, which is exactly where a wiring bug hides.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

let handlers: ConnHandlers | null = null;
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  return {
    connView: reactive(new Map()),
    attach: (_k: string, _t: unknown, h: ConnHandlers) => {
      handlers = h;
    },
    setFont: () => {},
    setTheme: () => {},
    detach: () => {},
    release: () => {},
    retarget: () => {},
    terminate: () => {},
    fit: () => {},
    focus: () => {},
    insertText: () => {},
    sendView: () => {},
    readBuffer: () => null,
    submitText: () => true,
    pasteText: () => true,
    pasteAndSubmit: () => true,
    listSlots: () => [],
    setScrollSpeed: () => {},
    makeEnterHandler: () => () => false,
    makeSendHandler: () => () => false,
    isSystemClipboard: () => false,
    isOpenableTerminalLink: () => false,
    isClaudeTarget: () => false,
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  handlers = null;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

async function mountCell() {
  const TerminalCell = (await import("../../../src/components/TerminalCell.vue")).default;
  const w = mount(TerminalCell, {
    attachTo: document.body,
    props: {
      uid: 1,
      home: "/home/me",
      initialCwd: "/home/me/repo",
      defaultCwd: "/home/me/repo",
      sessionId: "77777777-7777-7777-7777-777777777777",
      initialSessionId: "77777777-7777-7777-7777-777777777777",
      expanded: false,
      presets: [],
    },
  });
  await flushPromises();
  return w;
}

describe("TerminalCell + real Terminal: live cwd", () => {
  // A zoom teleports the terminal, which detaches and re-attaches its slot — and attach REPLAYS
  // the server-learned values to the freshly-bound handlers, cwd first and live cwd immediately
  // after, in one synchronous block. Anything that reacts to the cwd asynchronously therefore
  // lands AFTER the live cwd and undoes it: the header snaps back to the directory the agent
  // left, every time the user zooms. Same shape for a reconnect, whose two frames replay in the
  // same order.
  it("survives an attach replaying cwd and live cwd back to back", async () => {
    const w = await mountCell();
    handlers?.onCwd?.("/home/me/repo");
    handlers?.onLiveCwd?.("/home/me/wt/fix-login");
    await nextTick();
    await nextTick();
    expect(w.find(".cell-dir").text()).toMatch(/^~\/wt\/fix-login/);
  });

  // The same replay, but where the server-confirmed cwd DIFFERS from the one the cell started
  // with (a cell restored from a preset the server resolved elsewhere). Now the cwd genuinely
  // changes in that synchronous block, so anything watching it asynchronously fires after the
  // live cwd has already been applied.
  it("survives an attach replay that also changes the cwd", async () => {
    const w = await mountCell();
    handlers?.onCwd?.("/home/me/resolved");
    handlers?.onLiveCwd?.("/home/me/wt/fix-login");
    await nextTick();
    await nextTick();
    expect(w.find(".cell-dir").text()).toMatch(/^~\/wt\/fix-login/);
  });

  // The other order is a RELAUNCH: the cell is pointed at a new session, and the previous
  // session's move is not the new one's.
  it("drops the move when the server reports a cwd afterwards", async () => {
    const w = await mountCell();
    handlers?.onLiveCwd?.("/home/me/wt/fix-login");
    await nextTick();
    handlers?.onCwd?.("/home/me/other");
    await nextTick();
    await nextTick();
    expect(w.find(".cell-dir").text()).toMatch(/^~\/other/);
  });

  it("carries a manager-reported move all the way to the header", async () => {
    const w = await mountCell();
    expect(w.find(".cell-dir").text()).toMatch(/^~\/repo/);
    expect(handlers?.onLiveCwd).toBeTypeOf("function");

    handlers?.onLiveCwd?.("/home/me/wt/fix-login");
    await nextTick();
    await nextTick();
    expect(w.find(".cell-dir").text()).toMatch(/^~\/wt\/fix-login/);
  });
});
