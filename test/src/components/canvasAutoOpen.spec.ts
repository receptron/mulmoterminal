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
    emits: ["toggle-expand", "toggle-files", "toggle-canvas", "open-canvas", "toggle-tools", "session", "cwd", "run", "close", "move", "status"],
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

  // Nothing is enlarged, so there is no slot to put it in.
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
    w.findComponent({ name: "TerminalCell" }).vm.$emit("toggle-files");
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
});
