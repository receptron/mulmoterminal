// Enlarging a cell asks this server about its session: a waiting question, an agent's pane command,
// a stored card, the tool groups, and a `session:<id>` subscription. For a remote cell (#3506) that
// id is one this server has never seen, so none of it may happen; a local cell is the control.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
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
vi.mock("../../../src/components/GuiPanel.vue", () => ({ default: { name: "GuiPanel", props: ["sessionId"], template: "<div />" } }));

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

const mountEnlarged = (remoteHost: string | undefined) => {
  const cell: Cell = { uid: 1, session: SESSION, cwd: "/srv/project", ...(remoteHost ? { remoteHost } : {}) };
  return mount(TerminalGrid, {
    props: {
      cells: [cell],
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

const askedAbout = (): string[] => [...requested.filter((url) => url.includes(SESSION)), ...subscribed.channels.filter((channel) => channel.includes(SESSION))];

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
