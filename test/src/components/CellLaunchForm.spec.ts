import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CellLaunchForm from "../../../src/components/CellLaunchForm.vue";
import AgentMark from "../../../src/components/AgentMark.vue";
import type { AgentPick, CustomAgent } from "../../../common/customAgents";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";

// The launcher's two "there is already a session here" surfaces, mounted directly: a worktree row
// (one branch, one session) and a resume row. Both used to hand a running agent's terminal to a
// second cell — the worktree row by starting a second agent in the same working tree, the resume
// row by confirming its way past a badge that could not see another tab or another process
// (#1207).

type WorktreeRow = { path: string; branch: string | null; task: string; dirty: boolean; session?: unknown };
type SessionRow = { id: string; title: string; mtime: number; attached?: boolean; runningKey?: string | null };

function mockFetch(worktrees: WorktreeRow[] = [], sessions: SessionRow[] = []) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const mountForm = (
  openSessionIds: string[] = [],
  over: {
    dir?: string;
    presets?: { label: string; path: string }[];
    agent?: AgentPick;
    defaultCwd?: string | null;
    customAgents?: CustomAgent[];
    configUnavailable?: boolean;
  } = {},
) =>
  mount(CellLaunchForm, {
    // defaultCwd is deliberately NOT "/repo": the launcher treats the workspace differently — it
    // states that every GUI tool is available instead of offering the switches, and hides the
    // worktree section — so the ordinary case to mount is a PROJECT directory.
    props: { dir: "/repo", agent: "claude" as AgentPick, choice: null, defaultCwd: "/home/me/ws", presets: [], openSessionIds, ...over },
    global: { stubs: { ModelPicker: true } },
  });

/** Every fetch the launch form makes while the GUI-tools section renders. Module scope because two
 *  describes need it, and a second copy is a lint error rather than a convenience. */
const guiMcpFetch = () => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/gui-mcp-groups")) return { ok: true, json: async () => ({ groups: [] }) };
    if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
};

// The launch button of the chip for a given directory. The workspace chip is always first now, so
// selecting a chip by position picks the wrong one.
const launchButtonFor = (w: ReturnType<typeof mountForm>, path: string) => chipForPath(w, path).find('[data-testid="cell-chip-launch"]');

// The chip pointing at exactly this directory. The title is the path, optionally followed by " — "
// and a reason (running here / the workspace), so a WHOLE-path match is required: `startsWith(path)`
// alone would let a request for `/repo` select `/repo-backup` (CodeRabbit on #1359).
const chipForPath = (w: ReturnType<typeof mountForm>, path: string) => {
  const chip = w.findAll('[data-testid="cell-chip"]').find((c) => {
    const title = c.find('[data-testid="cell-chip-main"]').attributes("title") ?? "";
    return title === path || title.startsWith(`${path} —`);
  });
  if (!chip) throw new Error(`no chip for ${path}`);
  return chip;
};

const worktree = (over: Partial<WorktreeRow> = {}): WorktreeRow => ({ path: "/wt/fix-login", branch: "fix-login", task: "fix-login", dirty: false, ...over });

beforeEach(() => mockFetch());

describe("a worktree row", () => {
  it("starts a session when the worktree has none", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-resume"]').exists()).toBe(false);
    expect(row.find('[data-testid="wt-busy"]').exists()).toBe(false);
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
    expect(w.emitted("resume")).toBeUndefined();
  });

  // The one-session rule in action: continuing the worktree's own conversation rather than opening
  // a second agent beside it. The agent travels so the cell connects the endpoint that session IS.
  it("resumes the worktree's session when nobody is holding it", async () => {
    mockFetch([worktree({ session: { id: "s-1", attached: false, agent: "codex" } })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-resume"]').exists()).toBe(true);
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "s-1", cwd: "/wt/fix-login", agent: "codex" }]);
    expect(w.emitted("start")).toBeUndefined();
  });

  it("refuses a worktree whose session is open in another terminal", async () => {
    mockFetch([worktree({ session: { id: "s-1", attached: true, agent: "claude" } })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-busy"]').exists()).toBe(true);
    expect(row.attributes("disabled")).toBeDefined();
    expect(row.attributes("title")).toContain("open in another terminal");
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("resume")).toBeUndefined();
    expect(w.emitted("start")).toBeUndefined();
  });

  // A page left open across an upgrade gets rows with no `session` at all. It must behave as every
  // worktree row did before this shipped, not refuse them all.
  it("starts when the server sent no session field", async () => {
    mockFetch([worktree()]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="worktree-reuse"]').trigger("click");
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  it("says why a worktree only ever has one session", async () => {
    mockFetch([worktree()]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="wt-note"]').text()).toContain("one agent session");
  });
});

// #1527: the native dialog is modal to the USER and to nothing else, and the route spawns one per
// request — so clicking the folder button four times opened four dialogs on top of each other.
describe("the folder button", () => {
  /** The worktree/session answers as usual, but pick-file waits until the test closes the dialog. */
  function mockHeldPicker() {
    let close: (paths: string[]) => void = () => {};
    const held = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      close = (paths) => resolve({ ok: true, json: async () => ({ paths }) });
    });
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/pick-file")) return held;
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return { close };
  }

  it("refuses a second click while the dialog is open, and takes one again after it closes", async () => {
    const { close } = mockHeldPicker();
    const w = mountForm();
    await flushPromises();
    const button = w.find('[data-testid="cell-dir-pick"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    await flushPromises();
    expect(button.attributes("disabled")).toBeDefined();
    close(["/picked"]);
    await flushPromises();
    expect(button.attributes("disabled")).toBeUndefined();
    expect(w.emitted("update:dir")?.at(-1)).toEqual(["/picked"]);
  });
});

// A worktree is reachable without its row — the field takes any path, and launching in a worktree
// records it as a recent directory, so its chip appears too. Refusing only the row would leave the
// one-session rule holding on whichever way in the user did not take.
describe("a worktree reached without its row", () => {
  const taken = (attached = true) => worktree({ session: { id: "s-1", attached, agent: "claude" } });

  it("refuses the play button when the directory field IS a running worktree", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-testid="cell-dir-busy"]').text()).toContain("open in another terminal");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")).toBeUndefined();
  });

  // One session, not one RUNNING session: a worktree whose agent nobody is watching still has its
  // conversation, and the row is how it is continued. Starting beside it is the second session the
  // rule exists to prevent.
  it("refuses the field for a worktree whose session is merely there", async () => {
    mockFetch([taken(false)]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-testid="cell-dir-busy"]').text()).toContain("resume it from its row");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")).toBeUndefined();
  });

  // Codex, reviewing #1208: the comparison was `===`, so a path spelled another way walked past the
  // guard and started a second session in a worktree marked `in use`.
  it.each([["/wt/fix-login/"], ["/wt/./fix-login"], ["/repo/../wt/fix-login"], ["/wt//fix-login"]])(
    "refuses the same worktree spelled %s",
    async (spelling) => {
      mockFetch([taken()]);
      const w = mountForm([], { dir: spelling });
      await flushPromises();
      expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
      await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
      expect(w.emitted("start")).toBeUndefined();
    },
  );

  it("still launches from the field for a worktree with no session", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-testid="cell-dir-busy"]').exists()).toBe(false);
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  // The limit is on AGENTS sharing one working tree. A shell is not one — dir-session.ts leaves
  // shells out of the answer for the same reason — so it can still be opened there.
  it("lets a shell open in a worktree an agent is in", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { dir: "/wt/fix-login", agent: "shell" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeUndefined();
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  // The chip fills the field instead of launching, which is what puts the reason on screen — a
  // play button that silently does nothing reads as a broken app.
  it("fills the field rather than launching when a chip points at a taken worktree", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "fix-login", path: "/wt/fix-login" }] });
    await flushPromises();
    // By path, not by position: the workspace chip leads the list, so the first launch button is
    // no longer the worktree's.
    await launchButtonFor(w, "/wt/fix-login").trigger("click");
    expect(w.emitted("start")).toBeUndefined();
    expect(w.emitted("update:dir")?.at(-1)).toEqual(["/wt/fix-login"]);
  });

  // The refused chip is the one case a screen-reader user cannot fall back on the greyed-out field
  // below to explain itself, so the reason has to be on the control (CodeRabbit).
  it("tells a screen reader why the chip will not launch", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "fix-login", path: "/wt/fix-login" }] });
    await flushPromises();
    const label = launchButtonFor(w, "/wt/fix-login").attributes("aria-label") ?? "";
    expect(label).toContain("fix-login");
    expect(label).toContain("open in another terminal");
  });

  it("launches from a chip on an ordinary directory", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "repo", path: "/repo" }] });
    await flushPromises();
    // The workspace chip leads the row, so reach the ordinary directory's by path.
    await launchButtonFor(w, "/repo").trigger("click");
    expect(w.emitted("start")?.[0]).toEqual(["/repo"]);
  });
});

describe("a resume row", () => {
  const row = (over: Partial<SessionRow> = {}): SessionRow => ({ id: "s-9", title: "fix the parser", mtime: 1, ...over });

  // The agent travels with the id: since #1417 the row is one of the PICKED agent's own
  // conversations, and the cell has to connect the endpoint that wrote it.
  it("resumes a session nobody is holding", async () => {
    mockFetch([], [row()]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "s-9", cwd: "/repo", agent: "claude" }]);
  });

  // The case the grid's own list is blind to: the other viewer is a second browser tab or a second
  // mulmoterminal process, so only the server can say.
  it("refuses a session the server reports as attached, even with an empty grid list", async () => {
    mockFetch([], [row({ attached: true })]);
    const w = mountForm();
    await flushPromises();
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.find('[data-testid="ri-open"]').exists()).toBe(true);
    expect(item.attributes("disabled")).toBeDefined();
    await item.trigger("click");
    expect(w.emitted("resume")).toBeUndefined();
  });

  // An older server sends no `attached`, and the cell's own knowledge of its grid is then the only
  // thing standing between a second cell and a live session.
  it("still refuses a session this grid has open when the server said nothing", async () => {
    mockFetch([], [row()]);
    const w = mountForm(["s-9"]);
    await flushPromises();
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.attributes("disabled")).toBeDefined();
    await item.trigger("click");
    expect(w.emitted("resume")).toBeUndefined();
  });
});

// A session left running by a restart: alive, nobody attached, and until #1467 invisible — the
// launcher offered its conversation with nothing to say that a process was still holding it, and
// no way to end it short of `tmux kill-session` by hand.
describe("a resume row whose session is still running", () => {
  const running = (over: Partial<SessionRow> = {}): SessionRow => ({ id: "s-9", title: "fix the parser", mtime: 1, runningKey: "s-9", ...over });
  const postsTo = (call: unknown[]): string => String(call[0]);

  beforeEach(() => vi.restoreAllMocks());

  it("says it is running, and offers to stop it", async () => {
    mockFetch([], [running()]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="ri-running"]').exists()).toBe(true);
    expect(w.find('[data-testid="ri-stop"]').exists()).toBe(true);
    // Still resumable: stopping is the alternative to picking it up, not a replacement.
    expect(w.find('[data-testid="cell-resume-item"]').attributes("disabled")).toBeUndefined();
  });

  // For codex/agy/muse the row's id is the AGENT's conversation id while the running tmux session
  // is keyed by whatever MulmoTerminal minted at spawn. Resuming by the row's id starts a second
  // backend on a conversation that already has one (#1533) — picking it up means reattaching the
  // key it RUNS under.
  it("resumes under the surviving key, not the row's own id", async () => {
    mockFetch([], [running({ id: "conv-1", runningKey: "key-1" })]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "key-1", cwd: "/repo", agent: "claude" }]);
  });

  it("says nothing when the server reports no running session", async () => {
    mockFetch([], [running({ runningKey: null })]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="ri-running"]').exists()).toBe(false);
    expect(w.find('[data-testid="ri-stop"]').exists()).toBe(false);
  });

  // A row somebody is HOLDING is that terminal's to close: ending it from another cell's launch
  // form would pull a session out from under a tab the user cannot see from here.
  it("offers no stop for a session another terminal is holding", async () => {
    mockFetch([], [running({ attached: true })]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="ri-open"]').exists()).toBe(true);
    expect(w.find('[data-testid="ri-stop"]').exists()).toBe(false);
  });

  // An older server sends no `runningKey` at all, and must read as "nothing is running" — an
  // absent field must not grow a button that posts `undefined` at the terminate route.
  it("renders exactly as before against a server that never says", async () => {
    mockFetch([], [{ id: "s-9", title: "fix the parser", mtime: 1 }]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="ri-running"]').exists()).toBe(false);
    expect(w.find('[data-testid="ri-stop"]').exists()).toBe(false);
  });

  it("terminates the session and re-reads the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch([], [running()]);
    const w = mountForm();
    await flushPromises();
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await w.find('[data-testid="ri-stop"]').trigger("click");
    await flushPromises();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.slice(before);
    expect(calls.map(postsTo)).toContain("/api/session/s-9/terminate");
    // The reload is what makes the row's state the server's answer rather than a local guess.
    expect(calls.map(postsTo).some((u) => u.includes("/api/sessions"))).toBe(true);
  });

  // The KEY, not the row id: a codex/agy conversation started from a grid cell runs under a key
  // MulmoTerminal minted, and terminating the conversation id would kill nothing while reporting
  // success.
  it("terminates the key the server named, not the row's id", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetch([], [running({ id: "conversation-1", runningKey: "mt-key-2" })]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="ri-stop"]').trigger("click");
    await flushPromises();
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/session/mt-key-2/terminate");
    expect(urls.some((u) => u.includes("/api/session/conversation-1/terminate"))).toBe(false);
  });

  // The two race, and the order that loses leaves the cell attached to a session the terminate
  // then kills — a terminal that dies on arrival with nothing saying why (CodeRabbit on #1474).
  it("refuses to resume the row whose stop is still in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let release = (): void => {};
    const held = new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) });
    });
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/terminate")) return held;
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      return { ok: true, json: async () => ({ cwd: "/repo", sessions: [running()] }) };
    }) as unknown as typeof fetch;
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="ri-stop"]').trigger("click");
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.attributes("disabled")).toBeDefined();
    await item.trigger("click");
    expect(w.emitted("resume")).toBeUndefined();
    release();
    await flushPromises();
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockFetch([], [running()]);
    const w = mountForm();
    await flushPromises();
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await w.find('[data-testid="ri-stop"]').trigger("click");
    await flushPromises();
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(before);
  });
});

// A write into the user's Claude Code config that fails has to SAY so — the checkbox goes back and
// the row reads "failed", with the reason on the hover. The branch and the hover read the same
// accessor since #1339 (the hover used to assert non-null what the branch had just tested), so
// what is pinned here is that the message still arrives at the title.
describe("an MCP group row whose write failed", () => {
  it("puts the checkbox back and carries the reason on the hover", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const w = mountForm();
    await flushPromises();
    const toggle = w.find<HTMLInputElement>('[data-testid="cell-mcp-toggle-render"]');
    await toggle.setValue(true);
    await flushPromises();

    const failed = w.findAll("span.text-err-text");
    expect(failed).toHaveLength(1);
    expect(failed[0].text()).toBe("failed");
    expect(failed[0].attributes("title")).toBe("HTTP 500");
    expect(toggle.element.checked).toBe(false);
  });
});

// The workspace is where every GUI tool is reachable, so the launcher offers it whether or not it
// has ever been recorded as a recent directory — the recorded list is auto-populated by launching,
// which made the one directory that matters most the one you might not be able to click.
describe("the workspace chip", () => {
  // A Material Symbols icon IS its ligature text, so the glyph's name is part of the button's
  // text() — the chip reads "workspacesws" unless the icon is subtracted. Subtracted by element
  // rather than by the literal, so renaming the icon does not quietly stop stripping it.
  const chipLabels = (w: ReturnType<typeof mountForm>) =>
    w.findAll('[data-testid="cell-chip-main"]').map((chip) => {
      const icon = chip.find('[data-testid="cell-chip-workspace"]');
      return icon.exists() ? chip.text().replace(icon.text(), "") : chip.text();
    });

  it("is offered with no presets recorded at all", async () => {
    const w = mountForm([], { presets: [], defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(chipLabels(w)).toEqual(["WORKSPACE"]);
    expect(w.find('[data-testid="cell-chip-workspace"]').exists()).toBe(true);
  });

  it("leads the recorded directories, and only it is marked", async () => {
    const w = mountForm([], { presets: [{ label: "one", path: "/a/one" }], defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(chipLabels(w)).toEqual(["WORKSPACE", "one"]);
    expect(w.findAll('[data-testid="cell-chip-workspace"]')).toHaveLength(1);
  });

  // Nothing to remove: it is synthesised, so a delete would only put it back on the next render.
  // The recorded chip beside it keeps its own.
  it("has no remove button, while an ordinary chip does", async () => {
    const w = mountForm([], { presets: [{ label: "one", path: "/a/one" }], defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.findAll('[data-testid="cell-chip"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="cell-chip-del"]')).toHaveLength(1);
  });

  // The icon cannot say WHY it is special, and nothing else on screen does.
  it("says on hover what makes it worth picking", async () => {
    const w = mountForm([], { presets: [], defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-chip-main"]').attributes("title")).toContain("every GUI tool is available here");
  });
});

// A claude or codex session in the workspace is handed the WHOLE GUI MCP at spawn
// (carriesFullGuiMcp), so there is no per-directory choice to offer it. Four switches there would
// be worse than redundant: they write a per-folder registration that a claimed session then
// ignores, i.e. controls that visibly do nothing.
//
// "Whatever agent runs there" is NOT true and was the bug (#1423): antigravity reaches MCP through
// a per-directory file, never through a per-spawn config, so in the workspace it must still be
// asked. The cases below pin both halves.
describe("the GUI tool groups in the workspace", () => {
  it("states that everything is available instead of offering the switches", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(true);
  });

  // Named, so the claim is checkable rather than a bare "all". Derived from TOOL_GROUP_HEADINGS,
  // de-duplicated because render and media both read "Canvas".
  it("names what 'all of them' covers", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws" });
    await flushPromises();
    const text = w.find('[data-testid="cell-mcp-all"]').text();
    expect(text).toContain("Canvas");
    expect(text).toContain("Workspace data");
    expect(text).toContain("External accounts");
  });

  // An EMPTY field means the workspace (dirFor falls back to defaultCwd) — the case a comparison
  // against the raw input would miss.
  it("counts an empty directory field as the workspace", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "", defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(true);
  });

  // The invariant this must not break: a project directory still chooses, exactly as before.
  it("still offers the switches in a project directory", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/repo", defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-external"]').exists()).toBe(true);
  });

  // #1423. Both halves of the bug in one assertion: the claim was untrue for antigravity, AND the
  // same branch hid the switches — which is the only place in src/ that registers a group at all,
  // so the form promised every tool while removing the way to obtain any.
  it("asks antigravity in the workspace, rather than telling it that everything is available", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws", agent: "antigravity" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-external"]').exists()).toBe(true);
  });

  // The same question asked of the agent added after that fix. grok reaches MCP through
  // `.grok/config.toml`, so it is in exactly antigravity's position and must get the switches
  // rather than the promise — which is what makes #1423 a rule here and not a one-off repair.
  it("asks grok in the workspace too", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws", agent: "grok" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-external"]').exists()).toBe(true);
  });

  it("still tells codex in the workspace that everything is available", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws", agent: "codex" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(false);
  });

  // A custom agent IS the CLI its entry declares, with the user's command wrapped around it — the
  // appended argv carries the same --mcp-config a plain claude cell gets. Read from `entry.agent`,
  // never from the command text.
  it("treats a custom agent as the CLI its entry declares", async () => {
    guiMcpFetch();
    const nemotron: CustomAgent = { id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --" };
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws", agent: "custom:nemotron", customAgents: [nemotron] });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(true);
  });

  // A cell can outlive the config entry it was launched from. Its CLI is then unknowable, so the
  // form offers the switches: being wrong in the direction that still leaves a way out.
  it("offers the switches for a custom agent whose entry is gone", async () => {
    guiMcpFetch();
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws", agent: "custom:deleted", customAgents: [] });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-all"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
  });
});

// A worktree isolates work on ONE codebase onto a branch. The workspace is the hub a session works
// FROM — where the shared wiki / collections / accounting state lives — which is exactly what a
// detached branch would cut it off from, so offering the option there is offering a mistake.
describe("worktrees in the workspace", () => {
  it("hides the worktree section, git repo or not", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm([], { dir: "/home/me/ws", defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(false);
    expect(w.find('[data-testid="worktree-reuse"]').exists()).toBe(false);
  });

  // The invariant: a project directory is untouched.
  it("still offers it in a project directory", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);
  });
});

// The label names a ROLE, not a directory, so what the chip is called out loud adds the path —
// every other chip's label already IS its directory.
describe("what the workspace chip is called", () => {
  it("shows the role notation and speaks the directory", async () => {
    mockFetch();
    const w = mountForm([], { presets: [], defaultCwd: "/home/me/ws" });
    await flushPromises();
    const main = w.find('[data-testid="cell-chip-main"]');
    expect(main.text()).toContain("WORKSPACE");
    const spoken = main.attributes("aria-label") ?? "";
    expect(spoken).toContain("the workspace, /home/me/ws");
    expect(spoken).not.toContain("WORKSPACE");
  });

  it("keeps the real path on the hover, where the other chips keep theirs", async () => {
    mockFetch();
    const w = mountForm([], { presets: [], defaultCwd: "/home/me/ws" });
    await flushPromises();
    expect(w.find('[data-testid="cell-chip-main"]').attributes("title")).toContain("/home/me/ws");
  });

  it("speaks the launch button the same way", async () => {
    mockFetch();
    const w = mountForm([], { presets: [], defaultCwd: "/home/me/ws" });
    await flushPromises();
    const spoken = w.find('[data-testid="cell-chip-launch"]').attributes("aria-label") ?? "";
    expect(spoken).toContain("the workspace, /home/me/ws");
    expect(spoken).not.toContain("WORKSPACE");
  });
});

// #1372: every list under the field describes the directory the field named when it was fetched,
// and the field is editable the whole time. What used to happen is that the previous directory's
// resume rows stayed clickable — through a 300ms debounce and a round trip — under the new
// directory's name, and a click resumed exactly the session it offered.
describe("changing the directory", () => {
  const oldSession = { id: "s-old", title: "an old chat", mtime: 1 };
  // Comfortably over the form's own 300ms debounce: the wait is real time, and on a runner also
  // building it is the load spike rather than any one test that decides how long this takes.
  const UNTIL_LOADED_TIMEOUT_MS = 3000;
  const POLL_MS = 25;

  // A server that answers per directory, so "the rows came back" can be told from "the rows never
  // left" — the default mock replies the same thing whatever it is asked about.
  function mockFetchPerDir(rows: Record<string, { worktrees: WorktreeRow[]; sessions: SessionRow[] }>) {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      const cwd = new URL(u, "http://localhost").searchParams.get("cwd") ?? "";
      const here = rows[cwd] ?? { worktrees: [], sessions: [] };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: here.worktrees }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd, sessions: here.sessions }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  }

  // Real timers: the debounce is what this is about, and faking it here would only pin that the
  // reload is scheduled — which the spec above already covers. Gives up LOUDLY rather than falling
  // through, so a loaded runner that never finished loading says so instead of failing on the row
  // assertion below, which would read as "the fix regressed" (#1314).
  const untilLoaded = async (w: ReturnType<typeof mountForm>): Promise<void> => {
    await flushPromises(); // a mount's own load is in flight before the row it renders exists
    for (let waited_ms = 0; waited_ms < UNTIL_LOADED_TIMEOUT_MS; waited_ms += POLL_MS) {
      if (!w.find('[data-testid="cell-dir-loading"]').exists()) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      await flushPromises();
    }
    throw new Error(`the launcher was still loading ${UNTIL_LOADED_TIMEOUT_MS}ms after the directory changed`);
  };

  it("drops the previous directory's rows in the same tick, before the debounce has even elapsed", async () => {
    mockFetch([worktree({ session: null })], [oldSession]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="cell-resume-item"]').exists()).toBe(true);
    expect(w.find('[data-testid="worktree-reuse"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-dir-loading"]').exists()).toBe(false);

    await w.setProps({ dir: "/elsewhere" });

    expect(w.find('[data-testid="cell-resume-item"]').exists()).toBe(false);
    expect(w.find('[data-testid="worktree-reuse"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-dir-loading"]').exists()).toBe(true);
  });

  it("shows the new directory's own rows once they land, and stops saying it is loading", async () => {
    mockFetchPerDir({
      "/repo": { worktrees: [worktree({ session: null })], sessions: [oldSession] },
      "/elsewhere": { worktrees: [], sessions: [{ id: "s-new", title: "the other project", mtime: 2 }] },
    });
    const w = mountForm();
    await untilLoaded(w);
    expect(w.find('[data-testid="ri-title"]').text()).toBe("an old chat");

    await w.setProps({ dir: "/elsewhere" });
    await untilLoaded(w);

    expect(w.find('[data-testid="cell-dir-loading"]').exists()).toBe(false);
    expect(w.find('[data-testid="ri-title"]').text()).toBe("the other project");
    expect(w.find('[data-testid="worktree-reuse"]').exists()).toBe(false);
  });
});

// A CUSTOM AGENT is one of the user's own ways of starting Claude Code (#1414) — an Agent Picker
// option, not a launcher chip. What that has to mean on this form: it is offered with the agents,
// picking it still offers the model, and the agent-only sections stay.
describe("the Agent Picker's custom agents (#1414)", () => {
  const nemotron: CustomAgent = { id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --model nemotron-3-ultra:cloud --" };

  it("offers one as a picker button, after the built-in agents and before Shell", async () => {
    mockFetch();
    const w = mountForm([], { customAgents: [nemotron] });
    await flushPromises();
    const labels = w
      .find('[data-testid="agent-picker"]')
      .findAll('[data-testid="agent-picker-label"]')
      .map((b) => b.text());
    expect(labels).toEqual(["Claude", "Codex", "Antigravity", "Grok", "Muse", "Copilot", "Cursor", "Nemotron", "Shell"]);
  });

  it("reports the pick as `custom:<id>`, which is what the cell sends to /ws", async () => {
    mockFetch();
    const w = mountForm([], { customAgents: [nemotron] });
    await flushPromises();
    await w.find('[data-testid="agent-picker-custom:nemotron"]').trigger("click");
    expect(w.emitted("update:agent")?.[0]).toEqual(["custom:nemotron"]);
  });

  // It runs Claude Code, so the model picker and the agent-only sections stay — a Shell pick is
  // what removes them, and a custom agent is not a shell. The wrapper's own `--model` sits before
  // its `--`, so it is consumed by the wrapper and does not collide with this one.
  it("keeps the model picker and the agent-only sections", async () => {
    mockFetch();
    const w = mountForm([], { agent: "custom:nemotron", customAgents: [nemotron] });
    await flushPromises();
    expect(w.findComponent({ name: "ModelPicker" }).exists()).toBe(true);
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);
  });

  it("is just the built-in agents when the user has configured none", async () => {
    mockFetch();
    const w = mountForm([]);
    await flushPromises();
    // TERMINAL_AGENTS + Shell — asserted as a count derived from the list rather than a literal,
    // so adding a fifth agent does not read as this feature breaking.
    expect(w.find('[data-testid="agent-picker"]').findAll('[role="radio"]')).toHaveLength(TERMINAL_AGENTS.length + 1);
  });

  // Every option wears a mark, and the built-in agents wear their OWN one (AgentMark.vue's drawn
  // shapes, the same the rate-limit gauge uses) rather than a Material Symbol — added because a row
  // of six words in one weight said nothing about which tool each button starts. Derived from
  // TERMINAL_AGENTS, so a new agent that reaches the picker without a mark fails here.
  it("marks every built-in agent with its own drawn mark, and Shell with a symbol", async () => {
    mockFetch();
    const w = mountForm([], { customAgents: [nemotron] });
    await flushPromises();
    for (const agent of TERMINAL_AGENTS) {
      const button = w.find(`[data-testid="agent-picker-${agent}"]`);
      // The mark is asked for its OWN agent, not merely for a mark: a row that rendered Claude's
      // burst under every label would satisfy "an svg is present" while distinguishing nothing,
      // which is the whole thing this feature exists to do (CodeRabbit on #1521).
      expect(button.findComponent(AgentMark).props("agent")).toBe(agent);
      expect(button.find("svg").exists()).toBe(true);
      expect(button.find(".material-symbols-outlined").exists()).toBe(false);
    }
    // The two that are not agents: a plain terminal, and `tune` for the user's own command — not
    // Claude's burst, which would make a custom entry indistinguishable from the Claude row.
    expect(w.find('[data-testid="agent-picker-shell"]').find(".material-symbols-outlined").text()).toBe("terminal");
    expect(w.find('[data-testid="agent-picker-custom:nemotron"]').find(".material-symbols-outlined").text()).toBe("tune");
  });
});

// #1417: the list belongs to the AGENT the picker has selected, not to Claude. Before this it read
// ~/.claude/projects whatever was picked, so choosing Codex offered Claude's conversations and
// clicking one connected the codex endpoint to a key that only ever named a Claude transcript.
describe("the resume list follows the Agent Picker", () => {
  // Keyed by the ROUTE each agent's history is listed at, because that is what the change actually
  // does — there is no `?agent=` parameter, each agent has its own endpoint (common/agentSessionList).
  // `/api/sessions` is matched LAST: every other path contains it as a suffix.
  const ROUTES = ["/api/codex/sessions", "/api/antigravity/sessions", "/api/grok/sessions", "/api/sessions"];

  function mockAgentFetch(byRoute: Record<string, SessionRow[]>) {
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      const route = ROUTES.find((r) => u.startsWith(r));
      if (route) {
        asked.push(route);
        return { ok: true, json: async () => ({ cwd: "/repo", sessions: byRoute[route] ?? [] }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return asked;
  }

  const rowsFor = (title: string): SessionRow[] => [{ id: `id-${title}`, title, mtime: 1 }];

  it("lists the picked agent's own conversations, and names them in the heading", async () => {
    mockAgentFetch({ "/api/codex/sessions": rowsFor("a codex chat"), "/api/sessions": rowsFor("a claude chat") });
    const w = mountForm([], { agent: "codex" });
    await flushPromises();
    expect(w.find('[data-testid="ri-title"]').text()).toBe("a codex chat");
    expect(w.find('[data-testid="cell-resume-heading"]').text()).toBe("or resume a codex conversation here");
  });

  it("keeps Claude's heading, which is the default nearly every row wears", async () => {
    mockAgentFetch({ "/api/sessions": rowsFor("a claude chat") });
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="cell-resume-heading"]').text()).toBe("or resume here");
  });

  it("re-reads the list when the picker changes, and resumes as that agent", async () => {
    const asked = mockAgentFetch({ "/api/grok/sessions": rowsFor("a grok chat"), "/api/sessions": rowsFor("a claude chat") });
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="ri-title"]').text()).toBe("a claude chat");

    await w.setProps({ agent: "grok" });
    // The previous agent's rows go at once, rather than standing under the new agent's name for
    // the length of the fetch (#1372's rule, in a second dimension).
    expect(w.find('[data-testid="cell-resume-item"]').exists()).toBe(false);
    await flushPromises();
    expect(asked).toContain("/api/grok/sessions");
    expect(w.find('[data-testid="ri-title"]').text()).toBe("a grok chat");
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "id-a grok chat", cwd: "/repo", agent: "grok" }]);
  });

  // A custom agent runs Claude Code, so its history IS Claude's — the same rule that gives it the
  // model picker.
  it("gives a custom agent Claude's list", async () => {
    const asked = mockAgentFetch({ "/api/sessions": rowsFor("a claude chat") });
    const w = mountForm([], {
      agent: "custom:ollama",
      customAgents: [{ id: "ollama", label: "Ollama", agent: "claude", command: "ollama launch claude --" }],
    });
    await flushPromises();
    expect(asked).toEqual(["/api/sessions"]);
    expect(w.find('[data-testid="ri-title"]').text()).toBe("a claude chat");
  });

  // A shell resumes nothing, so there is no history to offer and no route to ask.
  it("asks for nothing, and shows no section, for a shell", async () => {
    const asked = mockAgentFetch({ "/api/sessions": rowsFor("a claude chat") });
    const w = mountForm([], { agent: "shell" });
    await flushPromises();
    expect(asked).toEqual([]);
    expect(w.find('[data-testid="cell-resume"]').exists()).toBe(false);
    // …and the loading row must not be left standing in its place.
    expect(w.find('[data-testid="cell-dir-loading"]').exists()).toBe(false);
  });
});

// #1447: the folder button posted to /api/pick-file and dropped a non-200 on the floor, so on a
// host with no dialog installed it was a button that did nothing and said nothing. The field still
// accepts a typed path — which nobody discovers unless the button explains itself.
describe("the folder button when the host has no file dialog", () => {
  const pickError = (w: ReturnType<typeof mountForm>) => w.find('[data-testid="cell-dir-pick-error"]');

  const mountWithPicker = async (picker: { ok: boolean; body: unknown }) => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/pick-file")) return { ok: picker.ok, status: picker.ok ? 200 : 500, json: async () => picker.body };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    }) as unknown as typeof fetch;
    const w = mountForm();
    await flushPromises();
    await w.find('[aria-label="Choose the working directory"]').trigger("click");
    await flushPromises();
    return w;
  };

  it("shows what the server said, under the field", async () => {
    const w = await mountWithPicker({ ok: false, body: { error: "No file dialog on this host — install zenity" } });
    expect(pickError(w).text()).toContain("install zenity");
  });

  it("says nothing when the dialog opened and the user cancelled", async () => {
    const w = await mountWithPicker({ ok: true, body: { paths: [] } });
    expect(pickError(w).exists()).toBe(false);
  });

  it("fills the field, and shows no error, when a folder comes back", async () => {
    const w = await mountWithPicker({ ok: true, body: { paths: ["/picked/dir"] } });
    expect(w.emitted("update:dir")?.at(-1)).toEqual(["/picked/dir"]);
    expect(pickError(w).exists()).toBe(false);
  });
});

// #1549: `git worktree add` checks out the whole tree — around six seconds on the reporter's
// 33,000-file monorepo — and the form was byte-identical to the one before the click for all of it.
// The button's only `disabled` test was "is the task field empty", and the field is cleared once
// the ANSWER lands, so it stayed live; `uniqueBranch` takes the next free suffix, so every extra
// press succeeded. Three presses, three worktrees: agent/<task>, -2, -3.
describe("creating a worktree", () => {
  /** Everything answers as usual, but the create waits until the test lets it finish. */
  function mockHeldCreate(answer: { ok: boolean; status?: number; body: unknown }, worktrees: WorktreeRow[] = []) {
    const bodies: string[] = [];
    let finish: () => void = () => {};
    const held = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      finish = () => resolve({ ok: answer.ok, status: answer.status ?? (answer.ok ? 200 : 500), json: async () => answer.body });
    });
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/worktrees/create")) {
        bodies.push(String(init?.body ?? ""));
        return held;
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return { finish, bodies };
  }

  const startButton = (w: ReturnType<typeof mountForm>) => w.find('[data-testid="wt-start"]');

  /** Type a task name and press the button, leaving the create in flight. */
  async function beginCreate(w: ReturnType<typeof mountForm>, task = "fix login") {
    await w.find('[data-testid="wt-task"]').setValue(task);
    await startButton(w).trigger("click");
    await flushPromises();
  }

  it("holds the button and says it is working while the worktree is being cut", async () => {
    const { finish } = mockHeldCreate({ ok: true, body: { path: "/wt/fix-login", branch: "agent/fix-login" } });
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="wt-task"]').setValue("fix login");
    expect(startButton(w).attributes("disabled")).toBeUndefined();
    await startButton(w).trigger("click");
    await flushPromises();
    expect(startButton(w).attributes("disabled")).toBeDefined();
    expect(startButton(w).text()).toContain("Creating…");
    finish();
    await flushPromises();
    expect(w.emitted("start")?.at(-1)).toEqual(["/wt/fix-login"]);
    expect(startButton(w).text()).toContain("New worktree");
  });

  // The Enter key is the OTHER way in and the input is never disabled, so the guard has to live in
  // the handler rather than only on the button — which is what makes this a fix and not a coat of
  // paint.
  it("creates exactly one worktree however many times it is asked", async () => {
    const { finish, bodies } = mockHeldCreate({ ok: true, body: { path: "/wt/fix-login" } });
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    await w.find('[data-testid="wt-task"]').trigger("keydown.enter");
    await startButton(w).trigger("click");
    await flushPromises();
    expect(bodies).toHaveLength(1);
    finish();
    await flushPromises();
    expect(bodies).toHaveLength(1);
    expect(w.emitted("start")).toHaveLength(1);
  });

  // The task name stays put on a failure: it is what the retry needs, and clearing it would make a
  // refused create look like one that worked.
  it("shows what the server said instead of nothing at all", async () => {
    const { finish } = mockHeldCreate({ ok: false, status: 500, body: { error: "fatal: Not a valid object name: 'main'." } });
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    finish();
    await flushPromises();
    expect(w.find('[data-testid="wt-error"]').text()).toContain("Not a valid object name");
    expect(w.emitted("start")).toBeUndefined();
    expect(startButton(w).attributes("disabled")).toBeUndefined();
  });

  // A 200 with no path is not a worktree to launch in, and treating it as one would start the agent
  // in whatever the directory field happens to say.
  it("refuses to launch on an answer that names no worktree", async () => {
    const { finish } = mockHeldCreate({ ok: true, body: { branch: "agent/fix-login" } });
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    finish();
    await flushPromises();
    expect(w.emitted("start")).toBeUndefined();
    expect(w.find('[data-testid="wt-error"]').exists()).toBe(true);
  });

  // One guard for the whole section: these all shell out to git in one repository, where a second
  // command contends on the index lock.
  it("holds the existing worktrees' own buttons while a create runs", async () => {
    const { finish } = mockHeldCreate({ ok: true, body: { path: "/wt/fix-login" } }, [worktree({ session: null })]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="wt-del"]').attributes("disabled")).toBeUndefined();
    await beginCreate(w);
    expect(w.find('[data-testid="wt-del"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-testid="worktree-reuse"]').attributes("disabled")).toBeDefined();
    finish();
    await flushPromises();
    expect(w.find('[data-testid="wt-del"]').attributes("disabled")).toBeUndefined();
  });

  it("does not offer the button at all with no task name", async () => {
    mockFetch();
    const w = mountForm();
    await flushPromises();
    expect(startButton(w).attributes("disabled")).toBeDefined();
    expect(startButton(w).classes()).toContain("disabled:opacity-40");
  });

  // The failure belongs to the repository it was refused in, and the section comes BACK for the
  // next directory — so a message kept in state would reappear under a repo it says nothing true
  // about. Waited out in real time, like the debounce spec below: what matters is the state after
  // the new directory's lists land, not that a timer was scheduled.
  it("drops the failure when the field moves to another repository", async () => {
    const { finish } = mockHeldCreate({ ok: false, status: 500, body: { error: "fatal: Not a valid object name: 'main'." } });
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    finish();
    await flushPromises();
    expect(w.find('[data-testid="wt-error"]').exists()).toBe(true);
    await w.setProps({ dir: "/elsewhere" });
    for (let waited_ms = 0; waited_ms < 3000; waited_ms += 25) {
      if (w.find('[data-testid="cell-worktrees"]').exists()) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      await flushPromises();
    }
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true); // the section is back…
    expect(w.find('[data-testid="wt-error"]').exists()).toBe(false); // …without the other repo's failure
  });

  // The harder half of the same rule: the field is editable for the whole round trip, so a refusal
  // can LAND after the move. Clearing on the change is not enough — the answer has to know which
  // repository it was about. (Observed during review, not flagged by either bot.)
  it("does not report a refusal that lands after the field has moved on", async () => {
    const { finish } = mockHeldCreate({ ok: false, status: 500, body: { error: "fatal: Not a valid object name: 'main'." } });
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    await w.setProps({ dir: "/elsewhere" }); // typed while the create is still in flight
    finish();
    for (let waited_ms = 0; waited_ms < 3000; waited_ms += 25) {
      if (w.find('[data-testid="cell-worktrees"]').exists()) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      await flushPromises();
    }
    expect(w.find('[data-testid="wt-error"]').exists()).toBe(false);
  });

  // Raised by Codex on #1550. `fetchWithTimeout` keeps its deadline armed across the BODY, so a
  // read that aborts after a 200 used to be absorbed into `{}` and reported as "the server answered
  // without a worktree path" — for a worktree that exists. The absorption is still right on a
  // refusal, where the STATUS is the answer and the body may not be JSON at all.
  it("reports an unreadable 200 body as a timeout, not as a worktree that was never made", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/create")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new DOMException("The operation was aborted.", "AbortError");
          },
        };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    }) as unknown as typeof fetch;
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    const text = w.find('[data-testid="wt-error"]').text();
    expect(text).toContain("Timed out");
    expect(text).not.toContain("without a worktree path");
    expect(w.emitted("start")).toBeUndefined();
  });

  it("still reads a refusal whose body is not JSON at all (a 403 from the origin guard)", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/create")) {
        return {
          ok: false,
          status: 403,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    }) as unknown as typeof fetch;
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    expect(w.find('[data-testid="wt-error"]').text()).toContain("403");
  });

  // `fetchWithTimeout` gives up at 60s, which a checkout large enough to make #1549 worth fixing can
  // exceed — and git carries on regardless. "Could not reach the server" would send the user to look
  // at their network for a worktree that is about to appear.
  it("says a timeout is a timeout, not an unreachable server", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/create")) throw new DOMException("The operation was aborted.", "AbortError");
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    }) as unknown as typeof fetch;
    const w = mountForm();
    await flushPromises();
    await beginCreate(w);
    const text = w.find('[data-testid="wt-error"]').text();
    expect(text).toContain("Timed out");
    expect(text).not.toContain("Could not reach");
  });
});

// The delete beside each row is the same shape of button on the same slow route, and had the same
// nothing: no guard, no progress, and `catch {}` over the answer.
describe("removing a worktree", () => {
  function mockHeldRemove(answer: { ok: boolean; status?: number; body: unknown }) {
    let finish: () => void = () => {};
    let calls = 0;
    const held = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      finish = () => resolve({ ok: answer.ok, status: answer.status ?? (answer.ok ? 200 : 500), json: async () => answer.body });
    });
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/remove")) {
        calls += 1;
        return held;
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [worktree({ session: null })] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return { finish, calls: () => calls };
  }

  it("removes once however many times the button is pressed, and shows which row it is on", async () => {
    const { finish, calls } = mockHeldRemove({ ok: true, body: { ok: true } });
    const w = mountForm();
    await flushPromises();
    const del = () => w.find('[data-testid="wt-del"]');
    await del().trigger("click");
    await flushPromises();
    expect(del().attributes("disabled")).toBeDefined();
    expect(del().text()).toContain("progress_activity");
    await del().trigger("click");
    await flushPromises();
    expect(calls()).toBe(1);
    finish();
    await flushPromises();
    expect(del().text()).toContain("delete");
  });

  it("says why a removal was refused", async () => {
    const { finish } = mockHeldRemove({ ok: false, status: 409, body: { ok: false, reason: "dirty" } });
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="wt-del"]').trigger("click");
    finish();
    await flushPromises();
    expect(w.find('[data-testid="wt-error"]').text()).toContain("uncommitted changes");
  });
});

// An empty chip row has two very different causes, and they used to look identical: a user who has
// opened no directories, and a config that could not be read at all. The second one now says so —
// and offers the only move left, since nothing else re-reads the config once the retries give up.
describe("CellLaunchForm — the config could not be read", () => {
  it("says nothing while the config is merely empty", async () => {
    const w = mountForm([], { presets: [] });
    await flushPromises();

    expect(w.find('[data-testid="cell-config-unavailable"]').exists()).toBe(false);
  });

  it("explains the empty chip row and offers another read", async () => {
    const w = mountForm([], { presets: [], configUnavailable: true });
    await flushPromises();

    const notice = w.find('[data-testid="cell-config-unavailable"]');
    expect(notice.exists()).toBe(true);

    await notice.find("button").trigger("click");
    expect(w.emitted("retry-config")).toHaveLength(1);
  });
});

describe("the GUI tools section has two answers again (#2066)", () => {
  // The workspace is TOLD it has everything; a directory-file agent is OFFERED the four switches.
  // Cursor was a third answer for one release — told it had nothing, because it reads a file
  // nothing here wrote — and #2066 made it a directory-file agent like grok. The switches are its
  // route now, so hiding them would be #1423 again: the control that is the agent's ONLY way to
  // register anything, absent from the form.
  it("offers cursor the switches, now that what they register reaches it", async () => {
    guiMcpFetch();
    const w = mountForm([], { agent: "cursor" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-none"]').exists()).toBe(false);
  });

  it("still offers them to grok, which genuinely reads what they register", async () => {
    guiMcpFetch();
    const w = mountForm([], { agent: "grok" });
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-none"]').exists()).toBe(false);
  });
});
