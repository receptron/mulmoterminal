import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, type VNode } from "vue";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";
import { mountRequests } from "../../helpers/mountRequests";
import { openInFilesPane } from "../../../src/composables/filesPaneOpener";
import { setFileLinkOpensPane } from "../../../src/composables/fileLinkOpensPane";

// #3238, part 4. A path clicked in a tile's output opens the Files pane beside THAT tile, the way the
// tile's menu would — including moving a pane that sits beside another tile, which saves the pane it
// leaves first. The file is opened only once the pane is rooted on the tile's directory: the pane
// reads a relative path against the root it is on, and the move is asynchronous.
//
// The grid registers the opener on mount; the click reaches it through `openInFilesPane`, which is
// what `tryOpenInPane` calls once the path's own checks have passed.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const flush = vi.fn(async () => undefined as boolean | undefined);
/** Each `openFile` with the pane's `cwd` AT THAT MOMENT in front: the root the file is read against. */
const openFile = vi.fn<(cwd: string | null, pathRel: string, location: unknown, newTab: boolean) => Promise<void>>(async () => {});

vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "rightPane", "canvasAvailable"],
    emits: ["toggle-expand", "open-files", "toggle-canvas", "open-canvas", "new-here", "session", "cwd", "close", "move", "status"],
    template: '<div class="stub-cell" />',
  },
}));
vi.mock("../../../src/components/CommandCell.vue", () => ({
  default: { name: "CommandCell", props: ["expanded", "command"], emits: ["toggle-expand", "close", "move", "status"], template: "<div />" },
}));
vi.mock("../../../src/components/LauncherCell.vue", () => ({
  default: { name: "LauncherCell", props: ["expanded", "launcher"], emits: ["toggle-expand", "close", "move", "status", "session"], template: "<div />" },
}));
vi.mock("../../../src/components/FilesPane.vue", () => ({
  default: {
    name: "FilesPane",
    props: ["cwd", "requestedPath", "initialState", "canvasTarget", "workspace"],
    emits: ["close", "dirty"],
    setup: (props: { cwd: string | null }, { expose, slots }: { expose: (e: Record<string, unknown>) => void; slots: { title?: () => VNode[] } }) => {
      expose({
        flush,
        reload: () => {},
        snapshot: () => ({ openPath: null, expanded: [] }),
        openFile: (pathRel: string, location: unknown, newTab: boolean) => openFile(props.cwd, pathRel, location, newTab),
      });
      return () => h("div", { class: "stub-files-pane" }, slots.title?.());
    },
  },
}));

const cell = (uid: number, session: string, cwd: string): Cell => ({ uid, session, cwd });
const CELLS = [cell(1, "s1", "/work/a"), cell(2, "s2", "/work/b")];
const requests = mountRequests(CELLS.flatMap((c) => c.session ?? []));

const mountGrid = (expandedUid: number | null = null) =>
  mount(TerminalGrid, {
    props: {
      cells: CELLS,
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
      listMode: false,
    },
    attachTo: document.body,
  });
type Grid = ReturnType<typeof mountGrid>;
const cells = (w: Grid) => w.findAllComponents({ name: "TerminalCell" });
const filesPane = (w: Grid) => w.findComponent({ name: "FilesPane" });
const click = (cwd: string, pathRel: string, session: string | null) => openInFilesPane(cwd, pathRel, undefined, false, session);

describe("a path clicked on the tiled grid (#3238)", () => {
  beforeEach(() => {
    localStorage.clear();
    requests.install();
    flush.mockClear();
    flush.mockResolvedValue(undefined);
    openFile.mockClear();
    setFileLinkOpensPane(true);
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    }
  });
  afterEach(() => {
    setFileLinkOpensPane(true);
    document.body.innerHTML = "";
  });

  it("opens the pane beside the clicked tile, rooted there, and opens the file in it — enlarging nothing", async () => {
    const w = mountGrid();
    expect(click("/work/b", "docs/a.md", "s2")).toBe(true);
    await flushPromises();
    expect(w.emitted("toggle-expand")).toBeUndefined();
    expect(filesPane(w).props("cwd")).toBe("/work/b");
    expect(openFile).toHaveBeenCalledWith("/work/b", "docs/a.md", undefined, false);
    w.unmount();
  });

  // The pane beside another tile moves, as the cell menu's Files would move it, and the move saves
  // the pane it leaves. The file must wait for the root to arrive: opened before, it would be read
  // against the OLD tile's directory.
  it("moves a pane that is beside another tile, and opens the file only once it is rooted there", async () => {
    const w = mountGrid();
    cells(w)[0].vm.$emit("open-files");
    await flushPromises();
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    let saved: (value: boolean | undefined) => void = () => {};
    flush.mockReturnValueOnce(new Promise<boolean | undefined>((resolve) => (saved = resolve)));
    expect(click("/work/b", "notes.md", "s2")).toBe(true);
    await flushPromises();
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    expect(openFile).not.toHaveBeenCalled();
    saved(undefined);
    await flushPromises();
    await flushPromises();
    expect(filesPane(w).props("cwd")).toBe("/work/b");
    expect(openFile).toHaveBeenCalledWith("/work/b", "notes.md", undefined, false);
    w.unmount();
  });

  it("opens nothing when the pane could not be saved out of the tile it is on", async () => {
    const w = mountGrid();
    cells(w)[0].vm.$emit("open-files");
    await flushPromises();
    flush.mockResolvedValueOnce(false);
    expect(click("/work/b", "notes.md", "s2")).toBe(true);
    await flushPromises();
    await flushPromises();
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    expect(openFile).not.toHaveBeenCalled();
    w.unmount();
  });

  describe("with the setting off", () => {
    beforeEach(() => setFileLinkOpensPane(false));

    it("leaves the click to its route: no pane opens", async () => {
      const w = mountGrid();
      expect(click("/work/b", "docs/a.md", "s2")).toBe(false);
      await flushPromises();
      expect(filesPane(w).exists()).toBe(false);
      expect(openFile).not.toHaveBeenCalled();
      w.unmount();
    });

    // The older rule (#3027): a pane already beside the tile still takes the click.
    it("still takes a click into a pane already beside that tile", async () => {
      const w = mountGrid();
      cells(w)[1].vm.$emit("open-files");
      await flushPromises();
      expect(click("/work/b", "docs/a.md", "s2")).toBe(true);
      await flushPromises();
      expect(openFile).toHaveBeenCalledWith("/work/b", "docs/a.md", undefined, false);
      w.unmount();
    });
  });

  it("declines a click whose directory is not the one its cell reports", async () => {
    const w = mountGrid();
    expect(click("/work/elsewhere", "docs/a.md", "s2")).toBe(false);
    expect(filesPane(w).exists()).toBe(false);
    w.unmount();
  });

  it("declines a click from a session this grid does not have", async () => {
    const w = mountGrid();
    expect(click("/work/b", "docs/a.md", "s9")).toBe(false);
    expect(click("/work/b", "docs/a.md", null)).toBe(false);
    expect(filesPane(w).exists()).toBe(false);
    w.unmount();
  });

  // Beside an enlarged cell nothing changes: the enlarged cell's click goes to its pane, a thumbnail's
  // to its route.
  it("keeps the enlarged grid's rule", async () => {
    requests.enlarge("s1");
    const w = mountGrid(1);
    await flushPromises();
    expect(click("/work/b", "docs/a.md", "s2")).toBe(false);
    expect(click("/work/a", "docs/a.md", "s1")).toBe(true);
    await flushPromises();
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    expect(openFile).toHaveBeenCalledWith("/work/a", "docs/a.md", undefined, false);
    w.unmount();
  });
});
