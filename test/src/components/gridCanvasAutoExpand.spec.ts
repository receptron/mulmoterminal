import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router";

// An agent draws while the grid is TILED — nothing enlarged. The cell enlarges itself and the
// Canvas opens beside it, because a thumbnail has nowhere to show a document and the only other
// trace is a count on a chip.
//
// The sibling case (a drawing landing on the cell that is ALREADY enlarged) belongs to
// TerminalGrid and is pinned in canvasAutoOpen.spec.ts. This side lives in GridView because
// un-zoomed TerminalGrid is handed one page of cells, and a cell on another page can draw too.

const pubsub = vi.hoisted(() => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    handlers,
    push(channel: string, data: unknown) {
      handlers.get(channel)?.forEach((cb) => cb(data));
    },
    reset() {
      handlers.clear();
    },
  };
});
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      const set = pubsub.handlers.get(channel) ?? new Set<(data: unknown) => void>();
      set.add(cb);
      pubsub.handlers.set(channel, set);
      return () => set.delete(cb);
    },
    onReconnect: () => () => {},
  }),
}));

// Must be UUIDs: parseGridState drops a cell whose session id is not one.
const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";

const ToolbarStub = { name: "AppToolbar", template: '<div class="toolbar-stub" />' };
const SettingsStub = { name: "SettingsModal", template: '<div class="settings-stub" />' };

// See CLAUDE.md: at module scope, never inside a test.
const GridView = (await import("../../../src/components/GridView.vue")).default;

const opened: number[] = [];
// Stands in for TerminalGrid, doing the one thing the real openCanvasFor does to the grid STATE:
// ask for the cell to be enlarged. Kept faithful to that emit so the tests below exercise the grid
// state too — on a single-terminal grid the enlargement used to be refused (#374), and then nothing
// whatsoever happened: no zoom, and no Canvas pane, which exists only in the zoomed row.
const CanvasGridStub = {
  name: "TerminalGrid",
  props: ["cells", "expandedUid"],
  emits: ["toggle-expand"],
  setup: (_: unknown, { expose, emit }: { expose: (api: Record<string, unknown>) => void; emit: (e: string, ...args: unknown[]) => void }) => {
    expose({
      openCanvasFor: (uid: number) => {
        opened.push(uid);
        emit("toggle-expand", uid);
      },
    });
    return () => null;
  },
};

const drew = { uuid: "u1", toolName: "presentDocument", data: { markdown: "# hi" } };

const storeCells = (cells: Array<{ uid: number; session: string; cwd: string; remoteHost?: string }>, expanded: number | null) =>
  localStorage.setItem("grid_v2", JSON.stringify({ cells, expanded, page: 0, sortMode: "manual" }));

const storeGrid = (expanded: number | null) =>
  storeCells(
    [
      { uid: 10, session: S1, cwd: "/w" },
      { uid: 11, session: S2, cwd: "/w" },
    ],
    expanded,
  );

const mountGrid = async () => {
  const w = mount(GridView, {
    global: { stubs: { TerminalGrid: CanvasGridStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
  });
  await flushPromises(); // onMounted loadConfig
  return w;
};

// The uid the grid actually gave the cell holding `session` — uids are renumbered on load.
const uidOf = (w: Awaited<ReturnType<typeof mountGrid>>, session: string) =>
  (w.findComponent(CanvasGridStub).props("cells") as Array<{ uid: number; session: string | null }>).find((c) => c.session === session)?.uid;

beforeEach(async () => {
  opened.length = 0;
  pubsub.reset();
  localStorage.clear();
  globalThis.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ cwd: "/w", home: "/w", cwdPresets: [], launchers: [] }) }) as Response,
  ) as typeof fetch;
  await router.push("/terminals");
  await flushPromises();
});

describe("the grid enlarging a cell that drew while nothing was enlarged", () => {
  it("enlarges the drawing cell and opens its Canvas", async () => {
    storeGrid(null);
    const w = await mountGrid();

    pubsub.push(`session:${S2}`, drew);
    await flushPromises();

    expect(opened).toEqual([uidOf(w, S2)]);
    expect(w.findComponent(CanvasGridStub).props("expandedUid")).toBe(uidOf(w, S2));
    w.unmount();
  });

  // The grid the owner actually had when he tried it: one terminal, which #374 refused to enlarge,
  // so nothing whatsoever happened — no zoom, no pane, no drawing.
  it("enlarges even when that terminal is the only one", async () => {
    storeCells([{ uid: 10, session: S1, cwd: "/w" }], null);
    const w = await mountGrid();

    pubsub.push(`session:${S1}`, drew);
    await flushPromises();

    expect(w.findComponent(CanvasGridStub).props("expandedUid")).toBe(uidOf(w, S1));
    w.unmount();
  });

  // manageCollection / google publish on the same channel and render no card. Enlarging for one
  // would take over the screen to show whatever was already in the pane.
  it("ignores a result no plugin renders", async () => {
    storeGrid(null);
    const w = await mountGrid();

    pubsub.push(`session:${S1}`, { uuid: "u2", toolName: "manageCollection", data: {} });
    await flushPromises();

    expect(opened).toEqual([]);
    w.unmount();
  });

  // While a cell IS enlarged this must stay out of it: TerminalGrid opens the pane for the
  // enlarged cell's own drawings, and deliberately does nothing for a background cell's.
  it("does nothing while a cell is already enlarged", async () => {
    storeGrid(10);
    const w = await mountGrid();

    pubsub.push(`session:${S2}`, drew);
    await flushPromises();

    expect(opened).toEqual([]);
    w.unmount();
  });

  // The grid stays mounted under a full-screen overlay. Rearranging it while the user is reading
  // something else would greet them, on the way back, with a zoom they never asked for.
  it("does nothing while the user is on another route", async () => {
    storeGrid(null);
    const w = await mountGrid();
    await router.push("/collections");
    await flushPromises();

    pubsub.push(`session:${S1}`, drew);
    await flushPromises();

    expect(opened).toEqual([]);
    w.unmount();
  });

  // #3506. A remote cell's drawings arrive from its host through the relay; this machine's channel
  // with the same bare id names another session.
  it("enlarges a remote cell on its host's drawing, and not on this machine's same id", async () => {
    storeCells([{ uid: 10, session: S1, cwd: "/w", remoteHost: "lx" }], null);
    const w = await mountGrid();

    pubsub.push(`session:${S1}`, drew);
    await flushPromises();
    expect(opened).toEqual([]);

    pubsub.push(`remote:lx:session:${S1}`, drew);
    await flushPromises();
    expect(w.findComponent(CanvasGridStub).props("expandedUid")).toBe(uidOf(w, S1));
    w.unmount();
  });
});
