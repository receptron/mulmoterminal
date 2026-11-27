// Enlarging a cell asks this server about its session: a waiting question, an agent's pane command,
// a stored card, the tool groups, and a `session:<id>` subscription. For a remote cell (#3506) that
// id is one this server has never seen, so none of it may happen; a local cell is the control.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import FilesPane from "../../../src/components/FilesPane.vue";
import PromptsPane from "../../../src/components/PromptsPane.vue";
import TranscriptPane from "../../../src/components/TranscriptPane.vue";
import ToolsPane from "../../../src/components/ToolsPane.vue";
import { openInFilesPane } from "../../../src/composables/filesPaneOpener";
import { dirKeyOf } from "../../../src/composables/dirAddress";
import { rememberPane } from "../../../src/components/filesPaneStore";
import { oneFile } from "./filesPaneFixture";
import type { Cell } from "../../../src/components/gridTabs.js";

const subscribed = vi.hoisted(() => ({ channels: [] as string[] }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string) => {
      subscribed.channels.push(channel);
      return () => {};
    },
    onReconnect: () => () => {},
  }),
}));
vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: { name: "TerminalCell", props: ["expanded"], template: '<div class="stub-cell" />' },
}));
vi.mock("../../../src/components/GuiPanel.vue", () => ({ default: { name: "GuiPanel", props: ["sessionId", "host", "unavailable"], template: "<div />" } }));

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";

let requested: string[] = [];
beforeEach(() => {
  requested = [];
  subscribed.channels = [];
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return { ok: true, status: 200, json: async () => ({ groups: [] }) };
    }),
  );
});

const cellOn = (uid: number, remoteHost: string | undefined): Cell => ({ uid, session: SESSION, cwd: "/srv/project", ...(remoteHost ? { remoteHost } : {}) });

const mountEnlarged = (remoteHost: string | undefined, cells: Cell[] = [cellOn(1, remoteHost)]) => {
  return mount(TerminalGrid, {
    props: {
      cells,
      expandedUid: 1,
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
};

// What THIS server is asked about the session: the gateway's routes answer from the host.
const askedAbout = (): string[] => [
  ...requested.filter((url) => url.includes(SESSION) && !url.startsWith("/remote/")),
  ...subscribed.channels.filter((channel) => channel.includes(SESSION) && !channel.startsWith("remote:")),
];

describe("an enlarged remote cell", () => {
  it("is asked about on this server only when it is local", async () => {
    const local = mountEnlarged(undefined);
    await flushPromises();
    expect(askedAbout().length).toBeGreaterThan(0);
    local.unmount();

    requested = [];
    subscribed.channels = [];
    mountEnlarged("lx");
    await flushPromises();
    expect(askedAbout()).toEqual([]);
  });
});

// The one pane a remote cell has (#3506): its files, on its host.
describe("a remote cell's Files pane", () => {
  const filesRequests = () => requested.filter((url) => url.includes("/api/files/"));

  it("is rooted at the cell's directory on its host, and asks this server nothing about it", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    expect(grid.vm.runCellAction("pane-files", 1)).toBe(true);
    await flushPromises();

    expect(grid.findComponent(FilesPane).props()).toMatchObject({ cwd: "/srv/project", host: "lx" });
    expect(filesRequests().length).toBeGreaterThan(0);
    expect(filesRequests().every((url) => url.startsWith("/remote/lx/api/files/browse/"))).toBe(true);
  });

  it("opens no pane that reads this machine's collections", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    expect(grid.vm.runCellAction("pane-collections", 1)).toBe(false);
  });

  // The same path on two machines is two directories: moving between them re-roots the pane.
  it("moves to the other machine when the zoom moves to a cell there with the same path", async () => {
    const grid = mountEnlarged(undefined, [cellOn(1, undefined), cellOn(2, "lx")]);
    await flushPromises();
    grid.vm.runCellAction("pane-files", 1);
    await flushPromises();
    expect(grid.findComponent(FilesPane).props("host")).toBeNull();
    expect(filesRequests().every((url) => url.startsWith("/api/files/browse/"))).toBe(true);

    requested = [];
    await grid.setProps({ expandedUid: 2 });
    await flushPromises();
    expect(grid.findComponent(FilesPane).props("host")).toBe("lx");
    expect(filesRequests().length).toBeGreaterThan(0);
    expect(filesRequests().every((url) => url.startsWith("/remote/lx/api/files/browse/"))).toBe(true);
    // Whether it can delete is the host's answer too.
    expect(filesRequests()).toContain("/remote/lx/api/files/browse/trash");
  });

  // A path clicked in a terminal, or asked for by an agent, is this machine's.
  it("takes no clicked path from this machine", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    grid.vm.runCellAction("pane-files", 1);
    await flushPromises();
    expect(openInFilesPane("/srv/project", "README.md", undefined, false, null)).toBe(false);
  });

  it("opens no pane beside it for a clicked path from this machine", async () => {
    mountEnlarged("lx");
    await flushPromises();
    expect(openInFilesPane("/srv/project", "README.md", undefined, false, null)).toBe(false);
  });

  it("opens one beside a local cell for its clicked path (control)", async () => {
    mountEnlarged(undefined);
    await flushPromises();
    expect(openInFilesPane("/srv/project", "README.md", undefined, false, null)).toBe(true);
  });

  it.each([
    ["a local cell takes it", undefined, true],
    ["a remote cell does not", "lx", false],
  ])("finds a tree this machine's same path left before a reload: %s", async (_name, remoteHost, takes) => {
    localStorage.setItem("files_pane_state", JSON.stringify(rememberPane([], "/srv/project", oneFile("README.md"))));
    const grid = mountEnlarged(remoteHost);
    await flushPromises();
    grid.vm.runCellAction("pane-files", 1);
    await flushPromises();
    expect(grid.findComponent(FilesPane).props("initialState") !== null).toBe(takes);
  });

  it("remembers its tree under its host, apart from this machine's same path", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    grid.vm.runCellAction("pane-files", 1);
    await flushPromises();
    grid.vm.runCellAction("pane-files", 1);
    await flushPromises();
    const stored = localStorage.getItem("files_pane_state") ?? "";
    expect(stored).toContain(JSON.stringify(dirKeyOf("lx", "/srv/project")).slice(1, -1));
    expect(stored).not.toContain('"/srv/project"');
  });
});

// Its session's prompts and conversation, read on its host (#3506).
describe("a remote cell's history panes", () => {
  const transcriptRequests = () => requested.filter((url) => url.includes("/api/transcript/"));

  it.each([
    ["pane-prompts", PromptsPane, "prompts"],
    ["pane-transcript", TranscriptPane, "view"],
  ] as const)("opens %s on its host, and asks this server nothing about the session", async (action, pane, route) => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    requested = [];
    expect(grid.vm.runCellAction(action, 1)).toBe(true);
    await flushPromises();
    expect(grid.findComponent(pane).props()).toMatchObject({ sessionId: SESSION, host: "lx" });
    expect(transcriptRequests().map((url) => url.split("?")[0])).toEqual([`/remote/lx/api/transcript/${route}`]);
    expect(askedAbout().every((url) => url.startsWith("/remote/lx/"))).toBe(true);
  });

  it("opens them on this machine for a local cell (control)", async () => {
    const grid = mountEnlarged(undefined);
    await flushPromises();
    requested = [];
    grid.vm.runCellAction("pane-prompts", 1);
    await flushPromises();
    expect(grid.findComponent(PromptsPane).props()).toMatchObject({ sessionId: SESSION, host: null });
    expect(transcriptRequests().map((url) => url.split("?")[0])).toEqual(["/api/transcript/prompts"]);
  });
});

// Its tool calls, read on its host and heard on the channel the relay follows for it (#3506).
describe("a remote cell's Tools pane", () => {
  it("reads the tools and calls on its host, and listens on its Mac-side channel", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    requested = [];
    subscribed.channels = [];
    expect(grid.vm.runCellAction("pane-tools", 1)).toBe(true);
    await flushPromises();
    expect(grid.findComponent(ToolsPane).props()).toMatchObject({ sessionId: SESSION, host: "lx" });
    expect(requested.filter((url) => url.includes("/tool")).sort()).toEqual([
      `/remote/lx/api/tool-calls/${SESSION}`,
      `/remote/lx/api/tools?sessionId=${SESSION}`,
    ]);
    expect(subscribed.channels.filter((channel) => channel.includes(SESSION))).toEqual([`remote:lx:toolcalls:${SESSION}`]);
  });

  it("reads them on this machine for a local cell (control)", async () => {
    const grid = mountEnlarged(undefined);
    await flushPromises();
    requested = [];
    subscribed.channels = [];
    grid.vm.runCellAction("pane-tools", 1);
    await flushPromises();
    expect(requested.filter((url) => url.includes("/tool")).sort()).toEqual([`/api/tool-calls/${SESSION}`, `/api/tools?sessionId=${SESSION}`]);
    expect(subscribed.channels).toContain(`toolcalls:${SESSION}`);
  });
});

// Its cards, read on its host (#3506). Its collections are not: that pane reads this machine's.
describe("a remote cell's Canvas", () => {
  it("opens on its host, as available as its host says, and offers no collections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return { ok: true, status: 200, json: async () => ({ groups: ["render", "data"], toolResults: [] }) };
      }),
    );
    const grid = mountEnlarged("lx");
    await flushPromises();
    expect(requested.filter((url) => url.includes("/tools?") || url.includes("toolResults")).sort()).toEqual([
      `/remote/lx/api/agent/toolResults/${SESSION}`,
      `/remote/lx/api/tools?sessionId=${SESSION}`,
    ]);
    expect(grid.vm.runCellAction("pane-canvas", 1)).toBe(true);
    await flushPromises();
    expect(grid.findComponent({ name: "GuiPanel" }).props()).toMatchObject({ sessionId: SESSION, host: "lx", unavailable: null });
    expect(grid.vm.runCellAction("pane-collections", 1)).toBe(false);
  });

  it("asks this server for a local cell's (control)", async () => {
    mountEnlarged(undefined);
    await flushPromises();
    expect(requested.filter((url) => url.includes("/tools?") || url.includes("toolResults")).sort()).toEqual([
      `/api/agent/toolResults/${SESSION}`,
      `/api/tools?sessionId=${SESSION}`,
    ]);
  });
});
