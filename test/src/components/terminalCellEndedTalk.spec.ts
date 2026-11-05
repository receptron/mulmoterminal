import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// A kept cell whose session ended (a crash #3272, a worktree, a startup failure) must not start a
// cross-talk or round table: its last turn would be typed into a live cell (#3276). The next
// connection — here a restart — gives it a session again, and the talk row with it.

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
  w.findComponent({ name: "TerminalView" }).vm.$emit("exit", 137, { sessionEnded, lifetimeMs: 60_000, reattached: false });
  await flushPromises();
}
async function openTalkPanel(w: Cell) {
  await openTools(w);
  toolButton("talk")?.click();
  await flushPromises();
}

afterEach(() => {
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

  it("offers the talk row again after a restart gives the cell a session", async () => {
    const w = mountCell();
    await flushPromises();
    await endSession(w, true);
    await openTools(w);
    toolButton("restart")?.click();
    await flushPromises();
    await openTools(w);
    expect(toolButton("talk")).not.toBeNull();
    w.unmount();
  });
});
