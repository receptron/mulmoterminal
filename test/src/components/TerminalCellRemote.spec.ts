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

// One partner always open, so the send button shows wherever the cell lets it; and the cwd and host
// each cell asked partners for: a remote cell's directory is looked up only with its host.
const relay = vi.hoisted(() => ({ cwds: [] as unknown[] }));
vi.mock("../../../src/composables/useRelayButton", async () => {
  const { computed } = await import("vue");
  return {
    useRelayButton: (_key: () => string, cwd: { value: unknown }, host: unknown) => {
      relay.cwds.push([cwd.value, host]);
      return computed(() => [{ key: "cell-9", sessionId: "partner", cwd: "/home/me/ws", agent: "claude" }]);
    },
  };
});

// The slots a send or bring pairs with, empty unless a test sets them.
const slots = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../../src/composables/useTerminalConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useTerminalConnections")>()),
  listSlots: () => slots.list,
}));

// The terminals the Talk menu lists, empty unless a test sets them.
const others = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../../src/composables/useHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useHandoff")>()),
  handoffTargets: () => others.list,
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
// What GET /api/remote-hosts/ids answers, or null for a request that never answers.
let configuredIds: string[] | null = ["lx"];
beforeEach(() => {
  requested = [];
  passed.remoteHost = [];
  relay.cwds = [];
  others.list = [];
  slots.list = [];
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
    if (String(url).includes("/worktrees/diff"))
      return { ok: true, json: async () => ({ isWorktree: true, base: "main", ahead: 1, dirty: 0, files: [], patch: "", truncated: false }) };
    if (String(url).includes("/worktrees/")) return { ok: true, json: async () => ({ ok: true, branch: "fix-x" }) };
    // A reap that confirms, so a restart goes on to reconnect.
    if (String(url).endsWith("/terminate")) return { ok: true, json: async () => ({ ended: true }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const runSend = (): boolean => requestCellAction("cell-1", "terminal-send-turn");

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

  it("offers no path menu, which acts on this machine; a local cell does", async () => {
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
  });

  // #3506. Its turns are read on its host, so it hands them over like a local cell.
  it("offers the send button for its partner", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    expect(remote.find('[data-testid="cell-send-btn"]').exists()).toBe(true);
  });

  // #3506. Its history menu opens what is read on its host: the prompts, the conversation and the
  // timeline. The tools menu keeps only its actions, and the timeline asks the host, not this server.
  it("offers its history from its host, and opens the timeline there", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    await remote.find('[data-testid="cell-history-btn"]').trigger("click");
    await flushPromises();
    const entries = [...document.body.querySelectorAll<HTMLElement>('[data-testid^="cell-pane-menu-"]')].map((entry) => entry.dataset.testid);
    expect(entries).toEqual(["cell-pane-menu-prompts", "cell-pane-menu-transcript", "cell-pane-menu-timeline"]);
    document.body.querySelector<HTMLElement>('[data-testid="cell-pane-menu-timeline"]')?.click();
    await flushPromises();
    expect(requested.filter((url) => url.includes("/transcript/timeline"))).toEqual([expect.stringMatching(/^\/remote\/lx\/api\/transcript\/timeline\?/)]);
    expect(requested.filter(mentionsCell)).toEqual([]);
  });

  // #3506. Its turns are handed over from its host: the Talk menu sends its relay through the gateway,
  // remembered there under the partner's machine. An exchange or a table is not offered.
  it("hands its turns over from its host, and seats no exchange or table", async () => {
    const LOCAL = { key: "cell-2", label: "#2 · claude", source: { sessionId: "22222222-2222-4222-8222-222222222222", cwd: "/home/me/ws", agent: "claude" } };
    others.list = [LOCAL];
    const remote = mountCell("lx");
    await flushPromises();
    remote.findComponent({ name: "TerminalView" }).vm.$emit("cwd", CWD);
    await remote.find('[data-testid="cell-tools-btn"]').trigger("click");
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-testid="cell-pane-menu-talk"]')?.click();
    await flushPromises();
    expect(remote.find('[data-testid="cell-exchange-item"]').exists()).toBe(false);
    expect(remote.findComponent({ name: "RoundTableMenu" }).exists()).toBe(false);
    requested = [];
    await remote.find('[data-testid="cell-send-since-item"]').trigger("click");
    await flushPromises();
    const relay = requested.find((url) => url.includes("/transcript/relay"));
    expect(relay?.startsWith("/remote/lx/api/transcript/relay?")).toBe(true);
    expect(new URL(relay ?? "", "https://x").searchParams.get("dest")).toBe("\0/home/me/ws");
    expect(requested.filter(mentionsCell)).toEqual([]);
    remote.unmount();
  });

  it("relays a terminal on this machine into itself, remembered there under its own host", async () => {
    others.list = [{ key: "cell-2", label: "#2 · claude", source: { sessionId: "22222222-2222-4222-8222-222222222222", cwd: "/home/me/ws", agent: "claude" } }];
    const remote = mountCell("lx");
    await flushPromises();
    remote.findComponent({ name: "TerminalView" }).vm.$emit("cwd", CWD);
    await remote.find('[data-testid="cell-tools-btn"]').trigger("click");
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-testid="cell-pane-menu-talk"]')?.click();
    await flushPromises();
    requested = [];
    await remote.find('[data-testid="cell-relay-item"]').trigger("click");
    await flushPromises();
    const relay = requested.find((url) => url.includes("/transcript/relay"));
    expect(relay?.startsWith("/api/transcript/relay?")).toBe(true);
    expect(new URL(relay ?? "", "https://x").searchParams.get("dest")).toBe(`lx\0${CWD}`);
    remote.unmount();
  });

  // The same path on this machine is another directory: a send pairs only terminals on its host.
  it("pairs a send with a terminal on its host, not one at the same path here", async () => {
    slots.list = [{ key: "cell-2", sessionId: "22222222-2222-4222-8222-222222222222", cwd: CWD, agent: "claude" }];
    const remote = mountCell("lx");
    await flushPromises();
    remote.findComponent({ name: "TerminalView" }).vm.$emit("cwd", CWD);
    requested = [];
    expect(runSend()).toBe(true);
    await flushPromises();
    expect(requested.filter((url) => url.includes("/transcript/"))).toEqual([]);
    expect(remote.text()).toContain("No other agent terminal");
    slots.list = [{ key: "cell-3", sessionId: "33333333-3333-4333-8333-333333333333", cwd: CWD, agent: "claude", host: "lx" }];
    runSend();
    await flushPromises();
    expect(requested.filter((url) => url.includes("/transcript/last-turn")).every((url) => url.startsWith("/remote/lx/"))).toBe(true);
    expect(requested.some((url) => url.includes("/transcript/last-turn"))).toBe(true);
    remote.unmount();
  });

  // #3506. A remote worktree's diff, push, pull request and removal are its host's: each goes through
  // the gateway, with the directory in the query that the gateway holds the body to.
  it("reads its worktree's diff and pushes, opens a PR and removes it on its host", async () => {
    const WT = "/srv/.mulmoterminal/worktrees/app-0123abcd/fix-x";
    vi.spyOn(window, "open").mockReturnValue(null);
    const remote = mount(TerminalCell, { props: { ...mountCell("lx").props(), initialCwd: WT } });
    await flushPromises();
    const query = `?cwd=${encodeURIComponent(WT)}`;
    expect(requested).toContain(`/remote/lx/api/worktrees/diff${query}`);
    expect(remote.findAll('[data-testid="cell-diff-btn"]')).toHaveLength(0);
    requested = [];
    expect(requestCellAction("cell-1", "terminal-diff")).toBe(true);
    await flushPromises();
    const [, push, pr] = remote.findAll('[data-testid="cell-diff-btn"]');
    await push?.trigger("click");
    await flushPromises();
    await pr?.trigger("click");
    await flushPromises();
    await remote.vm.close();
    await flushPromises();
    await remote.find('[data-testid="ccx-remove"]').trigger("click");
    await flushPromises();
    const body = JSON.stringify({ cwd: WT });
    expect(requested.filter((url) => /worktrees\/(push|pr|remove)/.test(url))).toEqual([
      `/remote/lx/api/worktrees/push${query} ${body}`,
      `/remote/lx/api/worktrees/pr${query} ${body}`,
      `/remote/lx/api/worktrees/remove${query} ${JSON.stringify({ repoDir: WT, path: WT, deleteBranch: true, force: true })}`,
    ]);
    // Nothing about the remote worktree reaches this server (the launch form it closes to lists this machine's own).
    expect(requested.filter((url) => !url.startsWith("/remote/lx/") && (url.includes(WT) || url.includes(encodeURIComponent(WT))))).toEqual([]);
    remote.unmount();
  });

  // #3506. The last code block is read from the session's own log, on its host.
  it("copies its last code block from its host", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    expect(remote.findComponent({ name: "CopyCodeBlock" }).props()).toMatchObject({ host: "lx" });
  });

  it("opens its Files pane from its path, without asking this server", async () => {
    const remote = mountCell("lx");
    await flushPromises();
    await remote.find('[data-testid="cell-dir"]').trigger("click");
    expect(remote.emitted("open-files")).toHaveLength(1);
    expect(requested.filter(mentionsCell)).toEqual([]);
  });

  it("looks for send partners in its directory on its host", async () => {
    mountCell(null);
    mountCell("lx");
    await flushPromises();
    expect(relay.cwds).toEqual([
      [CWD, null],
      [CWD, "lx"],
    ]);
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
