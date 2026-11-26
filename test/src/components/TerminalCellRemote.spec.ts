// A cell whose terminal runs on another MulmoTerminal (#3506) must never ask THIS server about its
// session or its directory: the id is one this server has never seen and the path names a directory
// on the other machine. Stated as a property of every request the cell makes, with a local cell
// beside it as the control that shows the same mount does make those requests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { resetConfiguredRemoteHosts } from "../../../src/composables/configuredRemoteHosts";
import { invalidateDirConfig } from "../../../src/composables/useDirConfig";
import { dirKeyOf } from "../../../src/composables/dirAddress";
import { requestCellAction } from "../../../src/composables/useCellAction";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// One partner always open, so the send button shows wherever the cell lets it; and the cwd each cell
// asked partners for, which a remote cell must not hand to this server's worktree lookup.
const relay = vi.hoisted(() => ({ cwds: [] as unknown[] }));
vi.mock("../../../src/composables/useRelayButton", async () => {
  const { computed } = await import("vue");
  return {
    useRelayButton: (_key: () => string, cwd: { value: unknown }) => {
      relay.cwds.push(cwd.value);
      return computed(() => [{ key: "cell-9", sessionId: "partner", cwd: "/home/me/ws", agent: "claude" }]);
    },
  };
});

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
// What GET /api/remote-hosts/ids answers, or null for a request that never answers.
let configuredIds: string[] | null = ["lx"];
beforeEach(() => {
  requested = [];
  passed.remoteHost = [];
  relay.cwds = [];
  configuredIds = ["lx"];
  resetConfiguredRemoteHosts();
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    // The body too: a POST carries the cwd there, and a URL-only check passes it by.
    requested.push(typeof init?.body === "string" ? `${String(url)} ${init.body}` : String(url));
    if (String(url).endsWith("/api/remote-hosts/ids")) {
      const ids = configuredIds;
      if (ids === null) return new Promise(() => {});
      return { ok: true, json: async () => ({ ids }) };
    }
    // A reap that confirms, so a restart goes on to reconnect.
    if (String(url).endsWith("/terminate")) return { ok: true, json: async () => ({ ended: true }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const mountCell = (remoteHost: string | null, launch: { initialSessionId: string | null; autoStart?: boolean } = { initialSessionId: SESSION }) =>
  mount(TerminalCell, {
    props: {
      ...launch,
      uid: 1,
      expanded: true,
      collectionsAvailable: false,
      zoomed: false,
      reorderable: false,
      initialCwd: CWD,
      defaultCwd: "/home/me/ws",
      presets: [],
      home: "/home/me",
      openSessionIds: [],
      openCwds: [],
      remoteHost,
    },
  });

// The gateway's routes are the one place a remote session's id or directory may go: they answer from the remote.
const forwardedToHost = (url: string): boolean => url.startsWith("/api/remote-hosts/lx/") || url.startsWith("/remote/lx/api/");
const mentionsCell = (url: string): boolean => !forwardedToHost(url) && (url.includes(SESSION) || url.includes(CWD) || url.includes(encodeURIComponent(CWD)));

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

  it("reads its git status, work item and directory settings from its own host", async () => {
    invalidateDirConfig(dirKeyOf("lx", CWD) ?? ""); // the settings are cached per directory across tests
    mountCell("lx");
    await flushPromises();
    const remoteCwd = encodeURIComponent(CWD);
    ["/remote/lx/api/git-status", "/remote/lx/api/pr-phase", "/remote/lx/api/dir-config"].forEach((route) =>
      expect(requested).toContain(`${route}?cwd=${remoteCwd}`),
    );
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
    // It tells its own host instead, through the gateway (#3506).
    expect(requested.some((url) => url.startsWith(`/remote/lx/api/session/${SESSION}/terminate`))).toBe(true);
  });

  it("saves its note on its host", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    await remote.find('[data-testid="cell-memo-edit"]').trigger("click");
    await nextTick();
    const input = remote.find('[data-testid="cell-memo-input"]');
    await input.setValue("ship it");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(requested).toContain(`/remote/lx/api/session/${SESSION}/memo {"text":"ship it"}`);
    expect(requested.filter(mentionsCell)).toEqual([]);
  });

  it("restarts by ending the session on its host, then reconnecting", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    const connectKey = () => Number(remote.findComponent({ name: "TerminalView" }).props("connectKey"));
    const before = connectKey();
    expect(requestCellAction("cell-1", "terminal-restart")).toBe(true);
    await flushPromises();
    expect(requested.some((url) => url.startsWith(`/remote/lx/api/session/${SESSION}/terminate`))).toBe(true);
    expect(requested.filter(mentionsCell)).toEqual([]);
    expect(connectKey()).toBeGreaterThan(before);
    remote.unmount();
  });

  it("offers no path menu, copy button or send button, which act on this machine; a local cell does", async () => {
    const local = mountCell(null);
    await flushPromises();
    expect(local.find('[data-testid="cell-dir"]').attributes("aria-haspopup")).toBe("true");
    expect(local.find('[data-testid="cell-send-btn"]').exists()).toBe(true);
    expect(local.findComponent({ name: "CopyCodeBlock" }).exists()).toBe(true);
    local.unmount();

    const remote = mountCell("lx");
    await flushPromises();
    const dir = remote.find('[data-testid="cell-dir"]');
    expect(dir.text()).toContain("project");
    expect(dir.attributes("aria-haspopup")).toBeUndefined();
    expect(remote.find('[data-testid="cell-send-btn"]').exists()).toBe(false);
    expect(remote.findComponent({ name: "CopyCodeBlock" }).exists()).toBe(false);
  });

  it("looks for send partners without its directory", async () => {
    mountCell(null);
    mountCell("lx");
    await flushPromises();
    expect(relay.cwds).toEqual([CWD, null]);
  });

  it("starting fresh, neither records its directory here nor reads it from this server", async () => {
    const fresh = { initialSessionId: null, autoStart: true };
    const local = mountCell(null, fresh);
    await flushPromises();
    local.findComponent({ name: "TerminalView" }).vm.$emit("cwd", CWD);
    expect(local.emitted("record-cwd")).toEqual([[CWD]]);
    local.unmount();

    requested = [];
    const remote = mountCell("lx", fresh);
    await flushPromises();
    remote.findComponent({ name: "TerminalView" }).vm.$emit("cwd", CWD);
    await flushPromises();
    expect(remote.emitted("record-cwd")).toBeUndefined();
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

// A host removed from config.json: the gateway refuses the socket and the reconnect loop would retry it forever.
describe("a cell whose remote host is no longer configured", () => {
  it("says so instead of mounting a terminal that cannot connect", async () => {
    configuredIds = ["other"];
    const remote = mountCell("lx");
    await flushPromises();
    expect(remote.find('[data-testid="remote-host-gone"]').text()).toContain("lx");
    expect(passed.remoteHost).toEqual([]);
    expect(remote.find(".cell-close").exists()).toBe(true);
  });

  it("waits for the list before connecting, and connects once the host is in it", async () => {
    configuredIds = null;
    const waiting = mountCell("lx");
    await flushPromises();
    expect(passed.remoteHost).toEqual([]);
    expect(waiting.find('[data-testid="remote-host-gone"]').exists()).toBe(false);
  });

  it("connects as before when the list cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    mountCell("lx");
    await flushPromises();
    expect(passed.remoteHost).toContain("lx");
  });

  it("is never asked about for a local cell", async () => {
    configuredIds = [];
    mountCell(null);
    await flushPromises();
    expect(requested.filter((url) => url.includes("/api/remote-hosts"))).toEqual([]);
    expect(passed.remoteHost).toEqual([null]);
  });
});
