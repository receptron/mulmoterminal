// @vitest-environment jsdom
// The launch panel's host picker (#3506). A remote start must not reach this machine's /api with the
// typed directory, which names a path on the other machine.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import LaunchPanel from "../../../src/components/LaunchPanel.vue";
import type { RemoteHostSummary } from "../../../common/remoteHosts";

const HOSTS: RemoteHostSummary[] = [
  { id: "lx", label: "Linux box", state: "reachable", version: "1.0.0" },
  { id: "down", label: "Down", state: "unreachable", version: null },
  { id: "old", label: "Old", state: "version-mismatch", version: "0.9.0" },
];

const NO_DIRS = { status: 200, body: { cwd: null, presets: [] } };
let requested: string[] = [];
let dirsAnswer: { status: number; body: unknown } = NO_DIRS;
// What the remote's conversation lists answer, through the gateway.
let remoteSessions: unknown[] = [];
let remoteListCwd: string | undefined = "/srv/app";
// The remote's worktree list, what its create answers, and the creates asked of it.
let remoteWorktrees: unknown = { isGit: false, worktrees: [] };
let createAnswer: { status: number; body: unknown } = { status: 200, body: {} };
let creates: { url: string; body: unknown }[] = [];
// Set to hold a create's answer back until the test lets it go.
let createGate: Promise<void> | null = null;
const stubFetch = (hosts: RemoteHostSummary[]) => {
  requested = [];
  dirsAnswer = NO_DIRS;
  remoteSessions = [];
  remoteListCwd = "/srv/app";
  remoteWorktrees = { isGit: false, worktrees: [] };
  createAnswer = { status: 200, body: {} };
  creates = [];
  createGate = null;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    requested.push(String(url));
    if (String(url).endsWith("/dirs")) return { ok: dirsAnswer.status === 200, status: dirsAnswer.status, json: async () => dirsAnswer.body };
    if (String(url).startsWith("/remote/lx/api/worktrees/create")) {
      creates.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      await createGate;
      return { ok: createAnswer.status === 200, status: createAnswer.status, json: async () => createAnswer.body };
    }
    if (String(url).startsWith("/remote/lx/api/worktrees")) return { ok: true, json: async () => remoteWorktrees };
    if (String(url).startsWith("/remote/lx/api/")) return { ok: true, json: async () => ({ cwd: remoteListCwd, sessions: remoteSessions }) };
    if (String(url).includes("/api/remote-hosts")) return { ok: true, json: async () => ({ hosts, rejected: [] }) };
    if (String(url).includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, base: null, worktrees: [] }) };
    if (String(url).includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
};

beforeEach(() => stubFetch(HOSTS));

const mountPanel = async () => {
  const w = mount(LaunchPanel, {
    props: { initialDir: "/home/me/proj", defaultCwd: "/home/me/workspace", presets: [], launchers: [], customAgents: [] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};
const pickHost = async (w: VueWrapper, id: string) => {
  await w.find(`[data-testid="remote-host-${id}"]`).trigger("click");
  await flushPromises();
};
const typeDir = async (w: VueWrapper, dir: string) => {
  await w.find('[data-testid="remote-launch"] [data-testid="cell-dir-input"]').setValue(dir);
};
// The form waits out the typing before it reads the directory's conversations.
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await flushPromises();
};
const ROW = { id: "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69", title: "fix the parser", mtime: 1 };

describe("the launch panel's host picker", () => {
  it("is absent when no remote host is configured, leaving the panel as it was", async () => {
    stubFetch([]);
    const w = await mountPanel();
    expect(w.find('[data-testid="remote-host-picker"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("lists every configured host, and refuses the ones that cannot start a terminal", async () => {
    const w = await mountPanel();
    expect(w.find('[data-testid="remote-host-lx"]').attributes("aria-disabled")).toBe("false");
    expect(w.find('[data-testid="remote-host-down"]').attributes("data-tip")).toContain("ssh");
    await pickHost(w, "down");
    await pickHost(w, "old");
    expect(w.find('[data-testid="remote-launch"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("starts on the remote with the typed directory and the picked agent", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(false);
    await typeDir(w, "/srv/app");
    await w.find('[data-testid="remote-agent-codex"]').trigger("click");
    await w.find('[data-testid="remote-launch"]').trigger("submit");
    expect(w.emitted("start-remote")).toEqual([[{ host: "lx", dir: "/srv/app", agent: "codex" }]]);
    expect(w.emitted("start")).toBeUndefined();
  });

  it("will not start on a path the remote would read as something else", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    await typeDir(w, "~/app");
    expect(w.find('[data-testid="remote-dir-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="remote-start"]').attributes("disabled")).toBeDefined();
    await w.find('[data-testid="remote-launch"]').trigger("submit");
    expect(w.emitted("start-remote")).toBeUndefined();
  });

  it("asks this machine nothing about the directory typed for the remote", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    requested = [];
    await typeDir(w, "/srv/app");
    await settle();
    expect(requested.filter((url) => !url.startsWith("/remote/lx/"))).toEqual([]);
  });

  it("lists the picked agent's past conversations on the host, and resumes one there", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    remoteSessions = [
      ROW,
      { id: "11111111-1111-4111-8111-111111111111", title: "still running", mtime: 2, runningKey: "22222222-2222-4222-8222-222222222222" },
    ];
    await typeDir(w, "/srv/app");
    await settle();
    expect(requested).toContain("/remote/lx/api/sessions?cwd=%2Fsrv%2Fapp");
    const rows = w.findAll('[data-testid="remote-resume-item"]');
    expect(rows.map((row) => row.text())).toEqual(["fix the parser", "still running"]);
    await rows[0]?.trigger("click");
    await rows[1]?.trigger("click");
    expect(w.emitted("resume-remote")).toEqual([
      [{ host: "lx", id: ROW.id, cwd: "/srv/app", agent: "claude" }],
      [{ host: "lx", id: "22222222-2222-4222-8222-222222222222", cwd: "/srv/app", agent: "claude" }],
    ]);
    expect(w.emitted("resume")).toBeUndefined();
  });

  it("reads the list of the agent picked, and none for a shell", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    requested = [];
    remoteSessions = [ROW];
    await typeDir(w, "/srv/app");
    await w.find('[data-testid="remote-agent-codex"]').trigger("click");
    await settle();
    expect(requested.filter((url) => url.includes("sessions"))).toEqual(["/remote/lx/api/codex/sessions?cwd=%2Fsrv%2Fapp"]);
    await w.findAll('[data-testid="remote-resume-item"]')[0]?.trigger("click");
    expect(w.emitted("resume-remote")?.[0]).toEqual([{ host: "lx", id: ROW.id, cwd: "/srv/app", agent: "codex" }]);
    requested = [];
    await w.find('[data-testid="remote-agent-shell"]').trigger("click");
    await settle();
    expect(requested).toEqual([]);
    expect(w.find('[data-testid="remote-resume"]').exists()).toBe(false);
  });

  it("resumes in the directory it read when the remote does not name one", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    remoteSessions = [ROW];
    remoteListCwd = undefined;
    await typeDir(w, "/srv/other");
    await settle();
    await w.find('[data-testid="remote-resume-item"]').trigger("click");
    expect(w.emitted("resume-remote")).toEqual([[{ host: "lx", id: ROW.id, cwd: "/srv/other", agent: "claude" }]]);
  });

  it("refuses a conversation a terminal is holding", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    remoteSessions = [{ ...ROW, attached: true }];
    await typeDir(w, "/srv/app");
    await settle();
    const row = w.find('[data-testid="remote-resume-item"]');
    expect(row.attributes("disabled")).toBeDefined();
    await row.trigger("click");
    expect(w.emitted("resume-remote")).toBeUndefined();
  });

  it("drops the rows when the directory changes, and reads nothing for one the remote cannot use", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    remoteSessions = [ROW];
    await typeDir(w, "/srv/app");
    await settle();
    expect(w.find('[data-testid="remote-resume"]').exists()).toBe(true);
    requested = [];
    await typeDir(w, "~/app");
    await flushPromises();
    expect(w.find('[data-testid="remote-resume"]').exists()).toBe(false);
    await settle();
    expect(requested).toEqual([]);
  });

  it("goes back to the local form when this machine is picked again", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    await w.find('[data-testid="remote-host-picker"] [role="radio"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("asks for the picked host's directories through this server, by host id only", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    expect(requested).toContain("/api/remote-hosts/lx/dirs");
  });

  it("opens on the remote's workspace and fills the field from its saved directories", async () => {
    const w = await mountPanel();
    dirsAnswer = {
      status: 200,
      body: {
        cwd: "/home/u/ws",
        presets: [
          { label: "app", path: "/home/u/app" },
          { label: "ws", path: "/home/u/ws" },
        ],
      },
    };
    await pickHost(w, "lx");
    const input = () => (w.find('[data-testid="remote-launch"] [data-testid="cell-dir-input"]').element as HTMLInputElement).value;
    expect(input()).toBe("/home/u/ws");
    const chips = w.findAll('[data-testid="remote-dir-chip"]');
    expect(chips.map((chip) => chip.attributes("data-tip"))).toEqual(["/home/u/ws", "/home/u/app"]);
    await chips[1]?.trigger("click");
    expect(input()).toBe("/home/u/app");
  });

  it("says why when the remote's directories cannot be read, and still starts on a typed one", async () => {
    const w = await mountPanel();
    dirsAnswer = { status: 502, body: { error: "Linux box did not answer" } };
    await pickHost(w, "lx");
    expect(w.find('[data-testid="remote-dirs-error"]').text()).toContain("Linux box did not answer");
    await typeDir(w, "/srv/app");
    await w.find('[data-testid="remote-launch"]').trigger("submit");
    expect(w.emitted("start-remote")).toHaveLength(1);
  });

  describe("the host's worktrees", () => {
    const SESSION = "33333333-3333-4333-8333-333333333333";
    const tree = (task: string, session: unknown = null) => ({ path: `/srv/app-wt/${task}`, branch: `agent/${task}`, task, dirty: false, session });
    const openForm = async () => {
      const w = await mountPanel();
      await pickHost(w, "lx");
      remoteWorktrees = {
        isGit: true,
        worktrees: [
          tree("free"),
          tree("idle", { id: SESSION, agent: "codex", attached: false }),
          tree("held", { id: SESSION, agent: "claude", attached: true }),
        ],
      };
      await typeDir(w, "/srv/app");
      await settle();
      return w;
    };
    const rows = (w: VueWrapper) => w.findAll('[data-testid="remote-wt-row"]');

    it("lists them from the host, and starts, resumes or refuses each by its one session", async () => {
      const w = await openForm();
      expect(requested).toContain("/remote/lx/api/worktrees?cwd=%2Fsrv%2Fapp");
      expect(rows(w).map((row) => row.attributes("disabled") !== undefined)).toEqual([false, false, true]);
      await rows(w)[0]?.trigger("click");
      await rows(w)[1]?.trigger("click");
      await rows(w)[2]?.trigger("click");
      expect(w.emitted("start-remote")).toEqual([[{ host: "lx", dir: "/srv/app-wt/free", agent: "claude" }]]);
      expect(w.emitted("resume-remote")).toEqual([[{ host: "lx", id: SESSION, cwd: "/srv/app-wt/idle", agent: "codex" }]]);
    });

    it("creates one on the host for the typed task, and starts in it", async () => {
      const w = await openForm();
      createAnswer = { status: 200, body: { path: "/srv/app-wt/fix-login", branch: "agent/fix-login" } };
      await w.find('[data-testid="remote-wt-task"]').setValue(" fix-login ");
      await w.find('[data-testid="remote-wt-start"]').trigger("click");
      await flushPromises();
      expect(creates).toEqual([{ url: "/remote/lx/api/worktrees/create?cwd=%2Fsrv%2Fapp", body: { repoDir: "/srv/app", task: "fix-login" } }]);
      expect(w.emitted("start-remote")).toEqual([[{ host: "lx", dir: "/srv/app-wt/fix-login", agent: "claude" }]]);
      expect((w.find('[data-testid="remote-wt-task"]').element as HTMLInputElement).value).toBe("");
    });

    it("says why a create failed, and starts nothing", async () => {
      const w = await openForm();
      createAnswer = { status: 500, body: { error: "could not create the worktree (is this a git repo?)" } };
      await w.find('[data-testid="remote-wt-task"]').setValue("t");
      await w.find('[data-testid="remote-wt-start"]').trigger("click");
      await flushPromises();
      expect(w.find('[data-testid="remote-wt-error"]').text()).toContain("could not create the worktree");
      createAnswer = { status: 200, body: { branch: "agent/t" } };
      await w.find('[data-testid="remote-wt-start"]').trigger("click");
      await flushPromises();
      expect(w.find('[data-testid="remote-wt-error"]').text()).toContain("without a worktree path");
      expect(w.emitted("start-remote")).toBeUndefined();
    });

    // The answer can take a minute, and by then the form may name another repo, another agent, or nothing.
    it.each([
      ["the directory changes", async (w: VueWrapper) => typeDir(w, "/srv/other")],
      ["the agent changes", async (w: VueWrapper) => w.find('[data-testid="remote-agent-codex"]').trigger("click")],
      // Back to this machine: the remote form unmounts while the panel that would place the cell stays,
      // and Vue drops an unmounted component's emits, so this case holds without a guard of ours.
      ["the form closes", async (w: VueWrapper) => w.find('[data-testid="remote-host-picker"] [role="radio"]').trigger("click")],
    ])("starts nothing when a create answers after %s", async (_when, moveOn) => {
      const w = await openForm();
      let release = (): void => undefined;
      createGate = new Promise((resolve) => {
        release = resolve;
      });
      createAnswer = { status: 200, body: { path: "/srv/app-wt/late", branch: "agent/late" } };
      await w.find('[data-testid="remote-wt-task"]').setValue("late");
      await w.find('[data-testid="remote-wt-start"]').trigger("click");
      await flushPromises();
      expect(creates).toHaveLength(1);
      await moveOn(w);
      release();
      await flushPromises();
      expect(w.emitted("start-remote")).toBeUndefined();
    });

    it("is not offered for a shell, the host's workspace, or a directory that is not a repo", async () => {
      const w = await openForm();
      expect(w.find('[data-testid="remote-worktrees"]').exists()).toBe(true);
      await w.find('[data-testid="remote-agent-shell"]').trigger("click");
      expect(w.find('[data-testid="remote-worktrees"]').exists()).toBe(false);
      await w.find('[data-testid="remote-agent-claude"]').trigger("click");
      remoteWorktrees = { isGit: false, worktrees: [] };
      await typeDir(w, "/srv/plain");
      await settle();
      expect(w.find('[data-testid="remote-worktrees"]').exists()).toBe(false);
    });

    it("hides them in the host's workspace", async () => {
      dirsAnswer = { status: 200, body: { cwd: "/srv/app", presets: [] } };
      const w = await openForm();
      expect(w.find('[data-testid="remote-worktrees"]').exists()).toBe(false);
    });
  });
});
