import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, type VNode } from "vue";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";

// A drawing that lands on the cell you are looking at opens the Canvas by itself: presentDocument
// IS the agent's answer, and with the pane closed the only trace was a count on a chip.
//
// The two limits pinned here are the whole design. It follows the ENLARGED cell only, so a
// background cell drawing never takes the screen from what you are doing elsewhere; and it acts
// only on a result that will actually RENDER, so the tools that publish without a view of their
// own do not cause a pane switch with nothing behind it.

// One shared registry of live handlers, so the test can publish on a session's channel exactly as
// the server does.
const bus = vi.hoisted(() => new Map<string, Set<(data: unknown) => void>>());
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      const entry = bus.get(channel) ?? new Set<(data: unknown) => void>();
      entry.add(cb);
      bus.set(channel, entry);
      return () => entry.delete(cb);
    },
    onReconnect: () => () => {},
  }),
}));
const publish = (channel: string, data: unknown) => {
  for (const cb of bus.get(channel) ?? []) cb(data);
};

vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "rightPane", "canvasAvailable"],
    emits: ["toggle-expand", "open-files", "toggle-canvas", "open-canvas", "toggle-tools", "session", "cwd", "run", "close", "move", "status"],
    template: '<div class="stub-cell" />',
  },
}));
vi.mock("../../../src/components/CommandCell.vue", () => ({
  default: {
    name: "CommandCell",
    props: ["expanded", "command"],
    emits: ["toggle-expand", "close", "move", "status"],
    template: '<div class="stub-command-cell" />',
  },
}));
vi.mock("../../../src/components/LauncherCell.vue", () => ({
  default: {
    name: "LauncherCell",
    props: ["expanded", "launcher"],
    emits: ["toggle-expand", "close", "move", "status", "session"],
    template: '<div class="stub-launcher-cell" />',
  },
}));
vi.mock("../../../src/components/GuiPanel.vue", () => ({
  default: { name: "GuiPanel", props: ["sessionId", "sendTextMessage", "unavailable"], template: '<div class="stub-canvas" />' },
}));
vi.mock("../../../src/components/ToolsPane.vue", () => ({ default: { name: "ToolsPane", props: ["sessionId"], template: '<div class="stub-tools" />' } }));
// The files pane refuses to go while its buffer cannot be saved — the one case where a drawing
// must NOT take the slot. `flush` is re-stubbed per test that cares.
const filesStub = vi.hoisted(() => ({ flush: vi.fn(async () => undefined as boolean | undefined) }));
vi.mock("../../../src/components/FilesPane.vue", () => ({
  default: {
    name: "FilesPane",
    props: ["cwd", "requestedPath", "initialState"],
    emits: ["close", "dirty"],
    setup: (_p: unknown, { expose, slots }: { expose: (e: Record<string, unknown>) => void; slots: { title?: () => VNode[] } }) => {
      expose({ flush: filesStub.flush, reload: () => {}, snapshot: () => ({ openPath: "README.md", expanded: ["src"] }) });
      return () => h("div", { class: "stub-files-pane" }, slots.title?.());
    },
  },
}));

const cell = (uid: number, session: string | null = null): Cell => ({ uid, session, cwd: "/work" });

const mountGrid = (cells: Cell[], expandedUid: number | null) =>
  mount(TerminalGrid, {
    props: {
      cells,
      expandedUid,
      listRows: [],
      cancelUid: null,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable: false,
      listMode: true,
    },
  });

const canvasOpen = (w: ReturnType<typeof mount>) => w.findComponent({ name: "GuiPanel" }).exists();
const drew = { uuid: "u1", toolName: "presentDocument", data: { markdown: "# hi" } };

beforeEach(() => {
  bus.clear();
  // jsdom has no matchMedia; the grid asks it for prefers-reduced-motion when the zoom moves.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.clear();
  filesStub.flush.mockReset();
  filesStub.flush.mockResolvedValue(undefined);
  // /api/tools, asked for the enlarged cell.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ groups: ["render"], tools: [] }) })),
  );
});

describe("the canvas opening itself when the agent draws", () => {
  it("opens on the enlarged cell when a result that renders arrives", async () => {
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);

    publish("session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
    expect(w.findComponent({ name: "GuiPanel" }).props("sessionId")).toBe("s1");
  });

  // manageCollection / google publish on the same channel and draw no card. Switching the pane
  // for one shows the user whatever was already there, with no visible reason.
  it("ignores a result no plugin renders", async () => {
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();

    publish("session:s1", { uuid: "u2", toolName: "manageCollection", data: {} });
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);
  });

  // The point of scoping this to the enlarged cell: cell 2 working in the background must not
  // pull the screen away from cell 1. Its unread chip (TerminalCell) is what reports it.
  it("leaves the pane alone when another cell draws", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], 1);
    await flushPromises();

    publish("session:s2", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);
  });

  // Nothing is enlarged, so there is no slot to put it in — and this component cannot make one:
  // un-zoomed it is handed a single PAGE of cells, while the drawing may be on another. GridView
  // owns that case (enlarge the drawing cell, then open the pane here); see
  // gridCanvasAutoExpand.spec.ts.
  it("does nothing while no cell is enlarged", async () => {
    const w = mountGrid([cell(1, "s1")], null);
    await flushPromises();

    publish("session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);
  });

  // Closing the pane dismisses the drawing in front of you; it is not a standing preference
  // against the next one.
  it("re-opens after the user closed the pane by hand", async () => {
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();
    publish("session:s1", drew);
    await flushPromises();

    // The same toggle the header button drives.
    w.findComponent({ name: "TerminalCell" }).vm.$emit("toggle-canvas");
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);

    publish("session:s1", { ...drew, uuid: "u3" });
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
  });

  // Taking the slot from the files pane unmounts its editor, so the buffer goes to disk first —
  // and a buffer that can be saved neither way keeps the pane it is visible in.
  it("flushes the files pane on the way out, and yields to one that refuses", async () => {
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();
    w.findComponent({ name: "TerminalCell" }).vm.$emit("open-files");
    await flushPromises();
    expect(w.find(".stub-files-pane").exists()).toBe(true);

    filesStub.flush.mockResolvedValue(false);
    publish("session:s1", drew);
    await flushPromises();
    expect(filesStub.flush).toHaveBeenCalled();
    expect(canvasOpen(w)).toBe(false);
    expect(w.find(".stub-files-pane").exists()).toBe(true);

    filesStub.flush.mockResolvedValue(undefined);
    publish("session:s1", { ...drew, uuid: "u4" });
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
  });

  // The flush is ASYNC, and the user can walk the zoom while a dirty buffer is being saved. On the
  // way back the drawing cell is no longer the enlarged one — enlarging it back would take the
  // screen from the cell they just moved to, which is the takeover this whole feature refuses.
  // Caught by Codex on PR #1227.
  it("gives up rather than pulling the zoom back when the user moved it during the flush", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], 1);
    await flushPromises();
    w.findComponent({ name: "TerminalCell" }).vm.$emit("open-files");
    await flushPromises();

    // A save still in flight when the drawing lands.
    let finishFlush: () => void = () => {};
    filesStub.flush.mockReturnValue(new Promise<undefined>((resolve) => (finishFlush = () => resolve(undefined))));
    publish("session:s1", drew);

    // The user zooms to cell 2 before the buffer is down.
    await w.setProps({ expandedUid: 2 });
    await flushPromises();
    finishFlush();
    await flushPromises();

    expect(canvasOpen(w)).toBe(false);
    // And above all: no attempt to drag cell 1 back into the zoom.
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });

  // The same race one step out, for the caller that DOES enlarge without a click: GridView's
  // reveal of a drawing on the tiled grid. Its preconditions (nothing enlarged, still on the grid)
  // are checked before a flush that then takes a network round trip, so they are re-asked through
  // `stillWanted` on the far side of it — otherwise the reveal enlarges over a zoom the user made
  // in the meantime, in exactly the situations it means to keep out of. Raised by Codex on PR #1371.
  it("drops an un-clicked reveal whose conditions stopped holding during the flush", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], null);
    await flushPromises();
    // Browse files on the tile also asks for the enlargement, which this fixture's parent ignores;
    // only a request made AFTER it counts below.
    w.findComponent({ name: "TerminalCell" }).vm.$emit("open-files");
    await flushPromises();
    const enlargeRequestsBefore = w.emitted("toggle-expand")?.length ?? 0;

    let finishFlush: () => void = () => {};
    filesStub.flush.mockReturnValue(new Promise<undefined>((resolve) => (finishFlush = () => resolve(undefined))));

    // What GridView passes: "still tiled, still on the grid" — false by the time the save lands.
    let wanted = true;
    const opening = (w.vm as unknown as { openCanvasFor: (u: number, e?: boolean, s?: () => boolean) => Promise<void> }).openCanvasFor(1, true, () => wanted);
    wanted = false;
    finishFlush();
    await opening;
    await flushPromises();

    expect(w.emitted("toggle-expand")?.length ?? 0).toBe(enlargeRequestsBefore);
    expect(canvasOpen(w)).toBe(false);
    // The files pane keeps the slot it had: nothing was taken from the user.
    expect(w.find(".stub-files-pane").exists()).toBe(true);
  });

  // A CLICK passes no guard: "bring that cell here" is a request that survives whatever moved
  // while the buffer was going down.
  it("still enlarges for a click, which passes no condition to re-check", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], null);
    await flushPromises();

    // The unread-canvas chip on a tiled cell.
    w.findComponent({ name: "TerminalCell" }).vm.$emit("open-canvas");
    await flushPromises();

    expect(w.emitted("toggle-expand")).toEqual([[1]]);
  });

  // Leaving Files awaits its save, so a pane pressed while the drawing waits can finish first.
  it("leaves a pane pressed during the flush in front of the drawing", async () => {
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();
    const terminal = w.findComponent({ name: "TerminalCell" });
    terminal.vm.$emit("open-files");
    await flushPromises();
    const finishSaves: ((saved: boolean) => void)[] = [];
    filesStub.flush.mockImplementation(() => new Promise((resolve) => finishSaves.push(resolve)));

    publish("session:s1", drew);
    terminal.vm.$emit("toggle-tools");
    expect(finishSaves).toHaveLength(2);
    finishSaves[1](true);
    await flushPromises();
    finishSaves[0](true);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);
    expect(w.findComponent({ name: "ToolsPane" }).exists()).toBe(true);
  });

  it("does not take the zoom for a canvas click a later press overtook during the flush", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], 1);
    await flushPromises();
    const [enlarged, tiled] = w.findAllComponents({ name: "TerminalCell" });
    enlarged.vm.$emit("open-files");
    await flushPromises();
    const finishSaves: ((saved: boolean) => void)[] = [];
    filesStub.flush.mockImplementation(() => new Promise((resolve) => finishSaves.push(resolve)));

    tiled.vm.$emit("open-canvas");
    enlarged.vm.$emit("toggle-tools");
    finishSaves[1](true);
    await flushPromises();
    finishSaves[0](true);
    await flushPromises();
    expect(w.emitted("toggle-expand")).toBeUndefined();
    expect(w.findComponent({ name: "ToolsPane" }).exists()).toBe(true);
  });

  // With the canvas switched off the drawing first asks the store for a card, which awaits too.
  it("leaves a pane pressed while the drawing asks for a stored card in front of it", async () => {
    let answerCard: (body: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/agent/toolResults/")) return new Promise((resolve) => (answerCard = (body) => resolve({ ok: true, json: async () => body })));
        return { ok: true, json: async () => ({ groups: [], tools: [] }) };
      }),
    );
    const w = mountGrid([cell(1, "s1")], 1);
    await flushPromises();

    publish("session:s1", drew);
    await flushPromises();
    w.findComponent({ name: "TerminalCell" }).vm.$emit("toggle-tools");
    await flushPromises();
    answerCard({ toolResults: [{ uuid: "u1", toolName: "presentDocument" }] });
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);
    expect(w.findComponent({ name: "ToolsPane" }).exists()).toBe(true);
  });

  // The subscription follows the enlarged cell, so walking the zoom must not leave the old
  // session able to open the pane.
  it("follows the zoom to another cell", async () => {
    const w = mountGrid([cell(1, "s1"), cell(2, "s2")], 1);
    await flushPromises();
    await w.setProps({ expandedUid: 2 });
    await flushPromises();

    publish("session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);

    publish("session:s2", { ...drew, uuid: "u5" });
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
  });

  // #3506. A remote cell's drawings arrive from its host through the relay; this machine's channel
  // with the same bare id names another session.
  it("opens on a remote cell's drawing from its host, and not on this machine's same id", async () => {
    const w = mountGrid([{ ...cell(1, "s1"), remoteHost: "lx" }], 1);
    await flushPromises();

    publish("session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(false);

    publish("remote:lx:session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
  });

  // The card it drew is on its host too, so a remote session without the render tools still opens
  // onto that card rather than "not enabled for this session".
  it("finds a remote cell's drawn card on its host", async () => {
    const cards: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.startsWith("/remote/lx/api/agent/toolResults/") ? { toolResults: cards } : { groups: [], tools: [], toolResults: [] };
        return { ok: true, json: async () => body };
      }),
    );
    const w = mountGrid([{ ...cell(1, "s1"), remoteHost: "lx" }], 1);
    await flushPromises();

    cards.push(drew);
    publish("remote:lx:session:s1", drew);
    await flushPromises();
    expect(canvasOpen(w)).toBe(true);
    expect(w.findComponent({ name: "GuiPanel" }).props("unavailable")).toBeFalsy();
  });
});

// #3506. The Canvas button's first answer is asked before the agent's MCP client is up, so it is the
// announcement that turns it on; a remote cell's comes from its host through the gateway's relay.
describe("the Canvas button turned on by a tool-groups announcement", () => {
  const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
  const canvasAvailable = (w: ReturnType<typeof mount>) => w.findComponent({ name: "TerminalCell" }).props("canvasAvailable");
  const noGroupsYet = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ groups: [], tools: [] }) })),
    );

  it("for a remote cell, from its own host only", async () => {
    noGroupsYet();
    const w = mountGrid([{ ...cell(1, SESSION), remoteHost: "lx" }], 1);
    await flushPromises();
    expect(canvasAvailable(w)).toBe(false);
    publish("tool-groups", { sessionId: SESSION, groups: ["render"] });
    publish("remote-tool-groups", { host: "other", announcement: { sessionId: SESSION, groups: ["render"] } });
    await flushPromises();
    expect(canvasAvailable(w)).toBe(false);
    publish("remote-tool-groups", { host: "lx", announcement: { sessionId: SESSION, groups: ["render"] } });
    await flushPromises();
    expect(canvasAvailable(w)).toBe(true);
  });

  it("for a local cell, from this machine only", async () => {
    noGroupsYet();
    const w = mountGrid([cell(1, SESSION)], 1);
    await flushPromises();
    publish("remote-tool-groups", { host: "lx", announcement: { sessionId: SESSION, groups: ["render"] } });
    await flushPromises();
    expect(canvasAvailable(w)).toBe(false);
    publish("tool-groups", { sessionId: SESSION, groups: ["render"] });
    await flushPromises();
    expect(canvasAvailable(w)).toBe(true);
  });
});
