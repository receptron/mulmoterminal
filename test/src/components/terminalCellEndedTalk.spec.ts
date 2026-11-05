import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// A kept cell whose session ended (a crash #3272, a worktree, a startup failure) must not start a
// cross-talk or round table: its last turn would be typed into a live cell (#3276). The mark lives on
// the terminal's slot, which outlives the component, and only the server's next `session` frame
// clears it. Terminal.vue is stubbed, so these tests write the slot's view state as the connection
// manager would.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    emits: ["session", "cwd", "exit"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: {
      terminate() {},
      showHint() {},
    },
  },
}));

vi.mock("../../../src/composables/useHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useHandoff")>()),
  handoffTargets: () => [{ key: "cell-2", label: "#2 · codex", source: { sessionId: "S2", cwd: "/w", agent: "codex" } }],
}));

const started = vi.hoisted(() => ({ exchanges: 0, tables: 0 }));
vi.mock("../../../src/composables/useCrossTalk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useCrossTalk")>()),
  runOneExchange: async () => {
    started.exchanges++;
    return { outcome: "done" };
  },
}));
vi.mock("../../../src/composables/useRoundTable", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useRoundTable")>()),
  runRoundTable: async () => {
    started.tables++;
    return { outcome: "done", turnsTaken: 0 };
  },
}));

const TerminalCell = (await import("../../../src/components/TerminalCell.vue")).default;
const { connView } = await import("../../../src/composables/useTerminalConnections");
const { applySessionExit, applySessionStart } = await import("../../../src/composables/connViewFrames");

const SLOT = "cell-1";
const markSlot = () => connView.set(SLOT, { status: "connected", serverCwd: null, inCopyMode: false, heatLevel: 0, heatFinales: 0, sessionEnded: false });

const mountCell = () => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, ended: true }) })) as unknown as typeof fetch;
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: "11111111-1111-1111-1111-111111111111",
      initialCwd: null,
      defaultCwd: "/home/me/proj",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });
};
type Cell = ReturnType<typeof mountCell>;

const toolButton = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-testid="cell-pane-menu-${id}"]`);
async function openTools(w: Cell) {
  await w.find('[data-testid="cell-tools-btn"]').trigger("click");
  await flushPromises();
}
async function endSession(w: Cell, sessionEnded: boolean) {
  applySessionExit(connView.get(SLOT), sessionEnded);
  w.findComponent({ name: "TerminalView" }).vm.$emit("exit", 137, { sessionEnded, lifetimeMs: 60_000, reattached: false });
  await flushPromises();
}
async function openTalkPanel(w: Cell) {
  await openTools(w);
  toolButton("talk")?.click();
  await flushPromises();
}

beforeEach(markSlot);

afterEach(() => {
  connView.delete(SLOT);
  started.exchanges = 0;
  started.tables = 0;
  document.body.innerHTML = "";
});

describe("talk from a cell whose session ended", () => {
  it("offers no talk row once the session ended, and the cell stays", async () => {
    const w = mountCell();
    await flushPromises();
    await endSession(w, true);
    await openTools(w);
    expect(w.emitted("close")).toBeUndefined();
    expect(toolButton("talk")).toBeNull();
    w.unmount();
  });

  // Only the tmux client was lost: the agent is still running, so it may still talk.
  it("keeps the talk row when only the client was lost", async () => {
    const w = mountCell();
    await flushPromises();
    await endSession(w, false);
    await openTools(w);
    expect(toolButton("talk")).not.toBeNull();
    w.unmount();
  });

  it("starts an exchange from a cell whose session is running", async () => {
    const w = mountCell();
    await flushPromises();
    await openTalkPanel(w);
    await w.find('[data-testid="cell-exchange-item"]').trigger("click");
    await flushPromises();
    expect(started.exchanges).toBe(1);
    w.unmount();
  });

  // The panel can already be open when the session ends; its buttons must not start anything.
  it.each([
    { name: "an exchange", start: async (w: Cell) => w.find('[data-testid="cell-exchange-item"]').trigger("click") },
    {
      name: "a round table",
      start: async (w: Cell) => {
        await w.find('[data-testid="round-table-seat"]').setValue(true);
        await w.find('[data-testid="round-table-start"]').trigger("click");
      },
    },
  ])("does not start $name from a panel opened before the end", async ({ start }) => {
    const w = mountCell();
    await flushPromises();
    await openTalkPanel(w);
    await endSession(w, true);
    await start(w);
    await flushPromises();
    expect(started).toEqual({ exchanges: 0, tables: 0 });
    w.unmount();
  });

  // The trip into and out of a collection pane remounts the cell; the slot, and its mark, stay.
  it("offers no talk row from a cell remounted on a slot whose session ended", async () => {
    applySessionExit(connView.get(SLOT), true);
    const w = mountCell();
    await flushPromises();
    await openTools(w);
    expect(toolButton("talk")).toBeNull();
    w.unmount();
  });

  it("offers the talk row again once the server reports a session on the slot", async () => {
    const w = mountCell();
    await flushPromises();
    await endSession(w, true);
    applySessionStart(connView.get(SLOT));
    await openTools(w);
    expect(toolButton("talk")).not.toBeNull();
    w.unmount();
  });
});
