import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";

// Capture the "sessions" pub/sub callback so tests can push activity directly.
let captured: ((data: unknown) => void) | null = null;
vi.mock("../composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, cb: (data: unknown) => void) => {
      captured = cb;
      return () => {};
    },
  }),
}));

// Stub the terminal so no xterm/WebSocket is needed; expose terminate() since
// the cell's close() calls it.
vi.mock("./Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term" />',
    methods: { terminate() {} },
  },
}));

const promptText = (w: ReturnType<typeof mount>) => w.find(".cell-prompt").text();
const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

// Route by URL: /api/scripts (run list), /api/sessions (resume list), or
// /api/session/:id (activity).
function mockFetch(sessions: { id: string; title: string; mtime: number }[] = [], scripts: { index: number; label: string; command: string }[] = []) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  captured = null;
  mockFetch();
});

function mountCell(
  initialSessionId: string | null,
  opts: { initialCwd?: string | null; defaultCwd?: string | null; presets?: { label: string; path: string }[]; home?: string | null } = {},
) {
  return mount(TerminalCell, {
    props: {
      expanded: false,
      initialSessionId,
      initialCwd: opts.initialCwd ?? null,
      defaultCwd: opts.defaultCwd ?? "/home/me/my-project",
      presets: opts.presets ?? [],
      home: opts.home ?? "/home/me",
    },
  });
}

describe("TerminalCell", () => {
  it("shows the ~-anchored workspace path in the header", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/ss/my-project" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("~/ss/my-project");
  });

  it("clicking the header dir asks the server to open that folder", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    globalThis.fetch = vi.fn((url: string, init?: { body?: string }) => {
      urls.push(String(url));
      if (init?.body) bodies.push(init.body);
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/ss/proj" });
    await flushPromises();
    await w.find(".cell-dir").trigger("click");

    expect(urls).toContain("/api/open-dir");
    expect(bodies.some((b) => b.includes("/home/me/ss/proj"))).toBe(true);
  });

  it("shows a non-home path in full", async () => {
    const w = mountCell("55555555-5555-5555-5555-555555555555", { initialCwd: "/var/data/proj" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("/var/data/proj");
  });

  it("shows '⎇ <repo> (<task>)' instead of the managed path for a worktree cell", async () => {
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-login" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("⎇ myrepo (fix-login)");
  });

  it("launches in the dir typed in the form and sends it to the terminal", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(w.find(".cell-launch").exists()).toBe(true);
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-start").trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("lists existing sessions for the dir and resumes one on click", async () => {
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "fix the parser", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const item = w.find(".cell-resume-item");
    expect(item.exists()).toBe(true);
    expect(item.find(".ri-title").text()).toBe("fix the parser");
    await item.trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("sessionId")).toBe("77777777-7777-7777-7777-777777777777");
    expect(term.props("cwd")).toBe("/home/me/proj");
  });

  it("lists script.json scripts for the dir and emits run with the resolved cwd", async () => {
    mockFetch(
      [],
      [
        { index: 0, label: "Build", command: "yarn build" },
        { index: 1, label: "Test", command: "yarn test" },
      ],
    );
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const items = w.findAll(".cell-script-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Build");
    await items[0].trigger("click");
    expect(w.emitted("run")?.[0]?.[0]).toEqual({ index: 0, label: "Build", cwd: "/home/me/proj" });
  });

  it("shows the resumed session's latest prompt from /api/session (with cwd), not the bare id", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn((url: string) => {
      urls.push(String(url));
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: "refactor the parser" }) });
    }) as unknown as typeof fetch;

    const id = "11111111-1111-1111-1111-111111111111";
    const w = mountCell(id, { initialCwd: "/home/me/proj" });
    await flushPromises();

    expect(w.find(".cell-prompt").text()).toBe("refactor the parser");
    expect(urls.some((u) => u.includes(`/api/session/${id}`) && u.includes("cwd=%2Fhome%2Fme%2Fproj"))).toBe(true);
  });

  it("shows no resume list when the dir has no sessions", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(w.find(".cell-resume").exists()).toBe(false);
  });

  it("ignores an out-of-order session-list response (keeps the latest dir's rows)", async () => {
    const first = deferred<unknown>(); // mount fetch (dir A) — resolves LAST
    const second = deferred<unknown>(); // preset fetch (dir B) — resolves first
    let n = 0;
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/api/sessions")) return n++ === 0 ? first.promise : second.promise;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    const w = mountCell(null, { defaultCwd: "/A", presets: [{ label: "B", path: "/B" }] });
    await nextTick(); // mount → fetch #1 (dir A) in flight
    const presetB = w.findAll(".cell-preset").find((b) => b.text() === "B");
    if (!presetB) throw new Error("preset B not found");
    await presetB.trigger("click"); // selectPreset → fetch #2 (dir B)

    second.resolve({ ok: true, json: async () => ({ cwd: "/B", sessions: [{ id: "b-id", title: "B-sess", mtime: 1 }] }) });
    await flushPromises();
    first.resolve({ ok: true, json: async () => ({ cwd: "/A", sessions: [{ id: "a-id", title: "A-sess", mtime: 1 }] }) });
    await flushPromises();

    expect(w.findAll(".ri-title").map((x) => x.text())).toEqual(["B-sess"]);
  });

  it("resumes with the resolved cwd from the API, not the typed input", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/api/sessions"))
        return Promise.resolve({ ok: true, json: async () => ({ cwd: "/resolved", sessions: [{ id: "id1", title: "t", mtime: Date.now() }] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell(null, { defaultCwd: "/typed" });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(w.findComponent({ name: "TerminalView" }).props("cwd")).toBe("/resolved");
  });

  it("selecting a preset sets the dir (doesn't launch); New then launches in it", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const btn = w.findAll(".cell-preset").find((b) => b.text() === "proj");
    if (!btn) throw new Error("preset button not found");
    await btn.trigger("click");
    // No terminal yet — the preset only selects the directory.
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/work/proj");
    expect(btn.classes()).toContain("active");
    // New terminal launches in the selected dir.
    await w.find(".cell-start").trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/work/proj");
  });

  it("resets the launch form to the default dir after close", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-start").trigger("click");
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find(".cell-launch").exists()).toBe(true);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/default");
  });

  it("adopts the EFFECTIVE cwd the server reports (persists/shows that, not the typed one)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("relative/bad/path");
    await w.find(".cell-start").trigger("click");
    // Server rejected the bad path and fell back; it reports the real cwd.
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/default");
    await nextTick();
    // The cell persists + displays the effective cwd, not the typed one.
    expect(w.emitted("cwd")?.at(-1)).toEqual(["/home/me/default"]);
    expect(w.find(".cell-dir").text()).toBe("~/default");
  });

  it("reflects working/waiting/lastPrompt pushed for its own session", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: true, waiting: false, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(promptText(w)).toBe("refactor the parser");
    expect(dotClass(w)).toContain("is-working");

    captured?.({ id, working: false, waiting: true, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-waiting");
  });

  it("clears a stale prompt when the server sends lastPrompt: null", async () => {
    const id = "33333333-3333-3333-3333-333333333333";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: false, waiting: false, lastPrompt: "old prompt" });
    await nextTick();
    expect(promptText(w)).toBe("old prompt");

    captured?.({ id, working: false, waiting: false, lastPrompt: null });
    await nextTick();
    // Falls back to the short session id, not the stale prompt.
    expect(promptText(w)).not.toBe("old prompt");
    expect(promptText(w)).toBe(id.slice(0, 8));
  });

  it("ignores activity for a different session", async () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id: "99999999-9999-9999-9999-999999999999", working: true, lastPrompt: "not mine" });
    await nextTick();
    expect(promptText(w)).not.toBe("not mine");
    expect(dotClass(w)).toContain("is-idle");
  });

  // The header's "open on GitHub" control: shown only when /api/git-remote
  // reports a repository URL for the cell's dir.
  function mockFetchWithGithub(githubUrl: string | null, ok = true) {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/git-remote")) return { ok, json: async () => ({ githubUrl }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
  }

  it("shows the GitHub button when the dir is a GitHub repo", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".cell-gh").exists()).toBe(true);
  });

  it("hides the GitHub button for a non-GitHub repo (null) and on lookup failure", async () => {
    mockFetchWithGithub(null);
    const a = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(a.find(".cell-gh").exists()).toBe(false);

    mockFetchWithGithub("https://github.com/owner/repo", false); // res.ok = false
    const b = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(b.find(".cell-gh").exists()).toBe(false);
  });

  it("opens repository / issues / pull requests from the popover", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();

    const openItem = async (label: string) => {
      await w.find(".cell-gh").trigger("click");
      const item = w.findAll(".cell-gh-item").find((b) => b.text() === label);
      await item?.trigger("click");
    };
    await openItem("Repository");
    await openItem("Issues");
    await openItem("Pull requests");

    expect(openSpy.mock.calls.map((c) => c[0])).toEqual([
      "https://github.com/owner/repo",
      "https://github.com/owner/repo/issues",
      "https://github.com/owner/repo/pulls",
    ]);
    openSpy.mockRestore();
  });

  it("toggles the popover and closes it on Escape", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".cell-gh-menu").exists()).toBe(false);
    await w.find(".cell-gh").trigger("click");
    expect(w.find(".cell-gh-menu").exists()).toBe(true);
    await w.find(".cell-gh-menu").trigger("keydown", { key: "Escape" });
    expect(w.find(".cell-gh-menu").exists()).toBe(false);
  });

  it("ignores an out-of-order /api/git-remote response after a fast cwd change", async () => {
    // dir A's lookup is in flight when the effective cwd switches to dir B; A
    // then resolves LAST. The request-token guard must keep B's repo, not A's.
    const repoA = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const repoB = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    globalThis.fetch = vi.fn((url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/git-remote")) return String(init?.body ?? "").includes("/home/me/repoA") ? repoA.promise : repoB.promise;
      if (u.includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repoA" });
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/repoB"); // server confirms a different dir
    await nextTick();

    repoB.resolve({ ok: true, json: async () => ({ githubUrl: "https://github.com/owner/repoB" }) }); // newer resolves first
    await flushPromises();
    repoA.resolve({ ok: true, json: async () => ({ githubUrl: "https://github.com/owner/repoA" }) }); // older resolves last
    await flushPromises();

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await w.find(".cell-gh").trigger("click");
    await w
      .findAll(".cell-gh-item")
      .find((b) => b.text() === "Repository")
      ?.trigger("click");
    expect(openSpy.mock.calls.at(-1)?.[0]).toBe("https://github.com/owner/repoB");
    openSpy.mockRestore();
  });

  // Per-agent worktree isolation: when the launcher's dir is a git repo, the cell
  // can start claude in its own managed worktree (create / reuse / remove).
  interface Wt {
    path: string;
    branch: string | null;
    task: string;
    dirty: boolean;
  }
  function mockFetchWithWorktrees(worktrees: Wt[] = [], created: { path: string; branch: string } = { path: "/wt/fix-login", branch: "agent/fix-login" }) {
    const posts: { url: string; body: string }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === "POST") posts.push({ url: u, body: String(init.body ?? "") });
      if (u.includes("/api/worktrees/create")) return { ok: true, json: async () => created };
      if (u.includes("/api/worktrees/remove")) return { ok: true, json: async () => ({ ok: true }) };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    return posts;
  }

  it("shows the worktree section and lists existing worktrees when the dir is a git repo", async () => {
    mockFetchWithWorktrees([{ path: "/wt/fix-login", branch: "agent/fix-login", task: "fix-login", dirty: false }]);
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".cell-worktrees").exists()).toBe(true);
    const rows = w.findAll(".wt-reuse");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("fix-login");
  });

  it("hides the worktree section for a non-git dir", async () => {
    mockFetch(); // default mock reports no isGit
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find(".cell-worktrees").exists()).toBe(false);
  });

  it("creates a worktree for the typed task and launches claude in it", async () => {
    const posts = mockFetchWithWorktrees([], { path: "/wt/fix-login", branch: "agent/fix-login" });
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    await w.find(".wt-task").setValue("fix login");
    await w.find(".wt-start").trigger("click");
    await flushPromises();
    const create = posts.find((p) => p.url.includes("/api/worktrees/create"));
    if (!create) throw new Error("create not called");
    expect(JSON.parse(create.body)).toEqual({ repoDir: "/home/me/repo", task: "fix login" });
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/wt/fix-login");
  });

  it("reuses an existing worktree by launching claude in its path", async () => {
    mockFetchWithWorktrees([{ path: "/wt/old-task", branch: "agent/old-task", task: "old-task", dirty: false }]);
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    await w.find(".wt-reuse").trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/wt/old-task");
  });

  it("removes a clean worktree (deleteBranch, no force) without confirming", async () => {
    const posts = mockFetchWithWorktrees([{ path: "/wt/done", branch: "agent/done", task: "done", dirty: false }]);
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    await w.find(".wt-del").trigger("click");
    await flushPromises();
    const remove = posts.find((p) => p.url.includes("/api/worktrees/remove"));
    if (!remove) throw new Error("remove not called");
    expect(JSON.parse(remove.body)).toEqual({ repoDir: "/home/me/repo", path: "/wt/done", deleteBranch: true, force: false });
  });

  it("confirms before removing a DIRTY worktree, and forces when confirmed", async () => {
    const posts = mockFetchWithWorktrees([{ path: "/wt/wip", branch: "agent/wip", task: "wip", dirty: true }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find(".wt-dirty").exists()).toBe(true); // the ● uncommitted-changes marker
    await w.find(".wt-del").trigger("click");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    const remove = posts.find((p) => p.url.includes("/api/worktrees/remove"));
    if (!remove) throw new Error("remove not called");
    expect(JSON.parse(remove.body).force).toBe(true);
    confirmSpy.mockRestore();
  });

  it("does NOT remove a dirty worktree when the user cancels the confirm", async () => {
    const posts = mockFetchWithWorktrees([{ path: "/wt/wip", branch: "agent/wip", task: "wip", dirty: true }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = mountCell(null, { defaultCwd: "/home/me/repo" });
    await flushPromises();
    await w.find(".wt-del").trigger("click");
    await flushPromises();
    expect(posts.some((p) => p.url.includes("/api/worktrees/remove"))).toBe(false);
    confirmSpy.mockRestore();
  });

  // Read-only worktree diff: a launched worktree cell shows an ahead/dirty badge
  // and opens a panel with the changed files + patch.
  const WT_CWD = "/home/me/.mulmoterminal/worktrees/repo-1a2b3c4d/fix";
  function mockFetchWithDiff(diff: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/diff")) return { ok: true, json: async () => diff };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
  }

  it("shows the ahead/dirty badge for a worktree cell and opens the diff panel", async () => {
    mockFetchWithDiff({
      isWorktree: true,
      base: "main",
      ahead: 3,
      dirty: 2,
      truncated: false,
      files: [
        { path: "src/a.ts", additions: 10, deletions: 2, status: "changed" },
        { path: "new.txt", additions: 0, deletions: 0, status: "untracked" },
      ],
      patch: "diff --git a/src/a.ts b/src/a.ts\n+hello\n",
    });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();

    const badge = w.find(".cell-wt-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.find(".wt-ahead").text()).toBe("+3");
    expect(badge.find(".wt-dirty-count").text()).toBe("●2");

    expect(w.find(".cell-diff").exists()).toBe(false); // panel closed initially
    await badge.trigger("click");
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(true);
    expect(w.findAll(".cell-diff-file")).toHaveLength(2);
    expect(w.find(".df-new").exists()).toBe(true); // the untracked file
    expect(w.find(".cell-diff-patch").text()).toContain("hello");

    await w.find(".cell-diff .cell-btn").trigger("click"); // ✕ closes it
    expect(w.find(".cell-diff").exists()).toBe(false);
  });

  it("shows no diff badge for a clean worktree (0 ahead / 0 dirty)", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 0, dirty: 0, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(false);
  });

  it("never shows the diff badge for a non-worktree cell", async () => {
    mockFetchWithDiff({ isWorktree: false, base: null, ahead: 9, dirty: 9, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/regular-proj" });
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(false);
  });

  it("bootstraps the diff badge when RESUMING an idle worktree session", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/diff"))
        return { ok: true, json: async () => ({ isWorktree: true, base: "main", ahead: 2, dirty: 0, files: [], patch: "", truncated: false }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: WT_CWD, sessions: [{ id: "wt-sess", title: "t", mtime: 1 }] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    const w = mountCell(null, { defaultCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click"); // resume the idle worktree session
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(true);
    expect(w.find(".wt-ahead").text()).toBe("+2");
  });

  it("clears the diff badge when the cwd falls back to a non-worktree dir", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 3, dirty: 1, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(true);
    // server confirms a different, non-worktree dir → badge must not linger
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/plain-proj");
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(false);
  });
});
