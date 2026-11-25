// A cell whose terminal runs on another MulmoTerminal (#3506) must never ask THIS server about its
// session or its directory: the id is one this server has never seen and the path names a directory
// on the other machine. Stated as a property of every request the cell makes, with a local cell
// beside it as the control that shows the same mount does make those requests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const passed = vi.hoisted(() => ({ remoteHost: [] as unknown[] }));
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader", "launch", "customAgent", "agent", "pathMenuPicker", "remoteHost"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    created(this: { remoteHost: unknown }) {
      passed.remoteHost.push(this.remoteHost);
    },
    methods: {
      terminate() {},
      showHint() {},
      submitText: () => true,
    },
  },
}));

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const CWD = "/srv/remote/project";

let requested: string[] = [];
beforeEach(() => {
  requested = [];
  passed.remoteHost = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const mountCell = (remoteHost: string | null) =>
  mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: true,
      collectionsAvailable: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: SESSION,
      initialCwd: CWD,
      defaultCwd: "/home/me/ws",
      presets: [],
      home: "/home/me",
      openSessionIds: [],
      openCwds: [],
      remoteHost,
    },
  });

const mentionsCell = (url: string): boolean => url.includes(SESSION) || url.includes(CWD) || url.includes(encodeURIComponent(CWD));

describe("a remote cell", () => {
  it("asks this server nothing about its session or directory, while a local cell does", async () => {
    const local = mountCell(null);
    await flushPromises();
    expect(requested.filter(mentionsCell).length).toBeGreaterThan(0);
    local.unmount();

    requested = [];
    mountCell("lx");
    await flushPromises();
    expect(requested.filter(mentionsCell)).toEqual([]);
  });

  it("closes without telling this server to end a session it does not have", async () => {
    const local = mountCell(null);
    await flushPromises();
    await local.find(".cell-close").trigger("click");
    await flushPromises();
    expect(requested.some((url) => url.includes(`/api/session/${SESSION}/terminate`))).toBe(true);
    local.unmount();

    requested = [];
    const remote = mountCell("lx");
    await flushPromises();
    await remote.find(".cell-close").trigger("click");
    await nextTick();
    await flushPromises();
    expect(remote.find('[data-testid="cell-launch"]').exists()).toBe(true);
    expect(requested.filter(mentionsCell)).toEqual([]);
  });

  it("names its host in the header and hands it to the terminal", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    expect(remote.find('[data-testid="cell-host-mark"]').text()).toContain("lx");
    expect(passed.remoteHost).toContain("lx");

    const local = mountCell(null);
    await flushPromises();
    expect(local.find('[data-testid="cell-host-mark"]').exists()).toBe(false);
  });
});
