import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { CELL_CHIP_BTN, CELL_CHIP_ICON } from "../../../src/components/cellChromeClasses";
import { TOOL_GROUPS } from "../../../common/toolGroups";

// Capture the "sessions" pub/sub callback and the reconnect handler so tests can push
// activity and simulate a dropped-then-restored socket directly.
let captured: ((data: unknown) => void) | null = null;
let reconnect: (() => void) | null = null;
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, cb: (data: unknown) => void) => {
      captured = cb;
      return () => {};
    },
    onReconnect: (cb: () => void) => {
      reconnect = cb;
      return () => {};
    },
  }),
}));

// Stub the terminal so no xterm/WebSocket is needed; expose terminate() since
// the cell's close() calls it.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    emits: ["session", "cwd"],
    // Render both of the header's slots so the cell's path menu (header-lead) and its icon
    // buttons (header-actions) are present in the test DOM — but only when the header is
    // shown, mirroring Terminal.vue's `v-if="!hideHeader"`.
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: {
      terminate() {},
      submitText() {
        return true;
      },
    },
  },
}));

// GET /api/session/:id itself — NOT its sub-routes (/memo, /terminate) and not the other polls a
// cell runs, which a "everything else" counter would fold in and make a refresh test read high.
const SESSION_DETAIL_RE = /\/api\/session\/[^/?]+(\?|$)/;

const promptText = (w: ReturnType<typeof mount>) => w.find('[data-testid="cell-prompt"]').text();
const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

// Route by URL: /api/scripts (run list), /api/sessions (resume list), or
// /api/session/:id (activity).
function mockFetch(
  sessions: { id: string; title: string; mtime: number; hidden?: boolean; failed?: boolean }[] = [],
  scripts: { index: number; label: string; command: string }[] = [],
) {
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
  reconnect = null;
  mockFetch();
});

function mountCell(
  initialSessionId: string | null,
  opts: {
    initialCwd?: string | null;
    defaultCwd?: string | null;
    presets?: { label: string; path: string }[];
    home?: string | null;
    cancellable?: boolean;
    openSessionIds?: string[];
    openCwds?: string[];
    expanded?: boolean;
    zoomed?: boolean;
    reorderable?: boolean;
    initialAgent?: "claude" | "codex" | "antigravity" | "grok";
  } = {},
) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      ...(opts.initialAgent ? { initialAgent: opts.initialAgent } : {}),
      expanded: opts.expanded ?? false,
      zoomed: opts.zoomed ?? false,
      reorderable: opts.reorderable ?? false,
      initialSessionId,
      initialCwd: opts.initialCwd ?? null,
      defaultCwd: opts.defaultCwd ?? "/home/me/my-project",
      presets: opts.presets ?? [],
      home: opts.home ?? "/home/me",
      cancellable: opts.cancellable ?? false,
      openSessionIds: opts.openSessionIds ?? [],
      openCwds: opts.openCwds ?? [],
    },
  });
}

// The chip pointing at a given directory. The workspace chip always leads the list (launchChips),
// so selecting a chip by position picks the wrong one — and it is matched on the PATH rather than
// the label because the demo workspace is `my-project`, which a substring match on "proj" finds
// first. Throws when nothing matches, so a stale selector fails as a selector rather than as a
// puzzling assertion about `undefined`.
function chipForPath(w: ReturnType<typeof mountCell>, path: string) {
  // A WHOLE-path match: the title is the path, optionally followed by " — " and a reason, so
  // `startsWith(path)` alone would let a request for `/repo` select `/repo-backup` (CodeRabbit).
  const chip = w.findAll('[data-testid="cell-chip"]').find((c) => {
    const title = c.find('[data-testid="cell-chip-main"]').attributes("title") ?? "";
    return title === path || title.startsWith(`${path} —`);
  });
  if (!chip) throw new Error(`no chip for ${path}`);
  return chip;
}

// An empty cell pointed at a PROJECT directory — deliberately NOT the workspace. Two parts of the
// launcher are absent there: the per-directory tool-group switches (the workspace is TOLD it has
// every tool, since it is handed the whole GUI MCP at spawn whatever agent runs there) and the
// worktree section (a worktree isolates work on one codebase; the workspace is what a session
// works FROM). So a test about either has to stand somewhere else — `mountCell` with no initialCwd
// points the field at defaultCwd, which IS the workspace.
const WORKSPACE = "/home/me/ws";
const mountProjectCell = (dir: string) => mountCell(null, { initialCwd: dir, defaultCwd: WORKSPACE });

describe("TerminalCell", () => {
  // #965: the whole cell — header included — sits in one wrapper, so the focus zoom can be
  // cancelled about the cell's own centre. A second element child, or content left outside the
  // wrapper, would scale with the frame and resample the terminal's canvas.
  it("keeps its whole content in the focus-zoom wrapper", () => {
    const root = mountCell(null).element;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].className).toContain("group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))]");
  });

  it("shows the ~-anchored workspace path in the header", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/ss/my-project" });
    await flushPromises();
    expect(w.find(".cell-dir-path").text()).toBe("~/ss/my-project");
  });

  it("revealing from the path menu asks the server to open that folder", async () => {
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
    await w.find(".cell-dir").trigger("click"); // opens the menu…
    await w.findAll('[data-testid="cell-path-item"]')[0].trigger("click"); // …Reveal is first

    expect(urls).toContain("/api/open-dir");
    expect(bodies.some((b) => b.includes("/home/me/ss/proj"))).toBe(true);
  });

  it("shows a non-home path in full", async () => {
    const w = mountCell("55555555-5555-5555-5555-555555555555", { initialCwd: "/var/data/proj" });
    await flushPromises();
    expect(w.find(".cell-dir-path").text()).toBe("/var/data/proj");
  });

  it("shows '⎇ <repo> (<task>)' instead of the managed path for a worktree cell", async () => {
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/.mulmoterminal/worktrees/myrepo-1a2b3c4d/fix-login" });
    await flushPromises();
    expect(w.find(".cell-dir-path").text()).toBe("⎇ myrepo (fix-login)");
  });

  it("launches in the dir typed in the form and sends it to the terminal", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/picked");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("launches via the go button next to the field (alternative to Enter)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/picked");
    await w.find('[data-testid="cell-dir-go"]').trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("disables the go button when the field is empty", async () => {
    const w = mountCell(null, { defaultCwd: null });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("   ");
    expect((w.find('[data-testid="cell-dir-go"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/picked");
    expect((w.find('[data-testid="cell-dir-go"]').element as HTMLButtonElement).disabled).toBe(false);
  });

  it("the folder button opens the OS folder picker and fills the working directory", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    let body: string | undefined;
    globalThis.fetch = vi.fn((url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/pick-file")) {
        body = init?.body;
        return Promise.resolve({ ok: true, json: async () => ({ paths: ["/picked/dir"] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;
    await w.find('[aria-label="Choose the working directory"]').trigger("click");
    await flushPromises();
    expect(body).toContain('"directory":true');
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/picked/dir");
  });

  it("shows a cancel ✕ on a cancellable launcher that emits close, but not otherwise", async () => {
    const plain = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(plain.find('[data-testid="cell-launch-cancel"]').exists()).toBe(false);

    const w = mountCell(null, { defaultCwd: "/home/me/default", cancellable: true });
    await flushPromises();
    await w.find('[data-testid="cell-launch-cancel"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("lists existing sessions for the dir and resumes one on click", async () => {
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "fix the parser", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.exists()).toBe(true);
    expect(item.find('[data-testid="ri-title"]').text()).toBe("fix the parser");
    await item.trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("sessionId")).toBe("77777777-7777-7777-7777-777777777777");
    expect(term.props("cwd")).toBe("/home/me/proj");
  });

  // A background worker has no cell and no bold row, so the launcher's list is where it is found.
  // Unlabelled, it is indistinguishable from the user's own chats — and a FAILED one is the case
  // nobody was ever told about, since it ran invisibly and ended without pulling any attention.
  it("labels a background worker, and marks a failed one", async () => {
    mockFetch([
      { id: "77777777-7777-7777-7777-777777777777", title: "refresh feeds", mtime: Date.now(), hidden: true, failed: true },
      { id: "88888888-8888-8888-8888-888888888888", title: "index the wiki", mtime: Date.now(), hidden: true },
      { id: "99999999-9999-9999-9999-999999999999", title: "my own chat", mtime: Date.now() },
    ]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    const items = w.findAll('[data-testid="cell-resume-item"]');

    // Failed wins over the plain background label: one badge, and it is the one that matters.
    expect(items[0].find('[data-testid="ri-failed"]').exists()).toBe(true);
    expect(items[0].find('[data-testid="ri-background"]').exists()).toBe(false);

    expect(items[1].find('[data-testid="ri-background"]').exists()).toBe(true);
    expect(items[1].find('[data-testid="ri-failed"]').exists()).toBe(false);

    // An ordinary chat gets neither — the labels have to MEAN something to be worth reading.
    expect(items[2].find('[data-testid="ri-background"]').exists()).toBe(false);
    expect(items[2].find('[data-testid="ri-failed"]').exists()).toBe(false);
  });

  it("resumes a failed background worker into the cell like any other session", async () => {
    // The point of labelling it: you can open it and read what happened. Nothing about being a
    // worker makes it a different kind of thing to attach to.
    const workerId = "77777777-7777-7777-7777-777777777777";
    mockFetch([{ id: workerId, title: "refresh feeds", mtime: Date.now(), hidden: true, failed: true }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("sessionId")).toBe(workerId);
  });

  it("flags a resumable row that's already open in another terminal", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([
      { id: openId, title: "running over there", mtime: Date.now() },
      { id: "99999999-9999-9999-9999-999999999999", title: "idle elsewhere", mtime: Date.now() },
    ]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    const items = w.findAll('[data-testid="cell-resume-item"]');
    expect(items[0].classes()).toContain("is-open");
    expect(items[0].find('[data-testid="ri-open"]').exists()).toBe(true);
    expect(items[1].classes()).not.toContain("is-open");
    expect(items[1].find('[data-testid="ri-open"]').exists()).toBe(false);
  });

  // It used to confirm and then take the session anyway. A confirm is the wrong instrument here:
  // whoever holds that session is detached the moment this cell gets it, and they are not the one
  // answering the dialog (#1207).
  it("will not resume a session open elsewhere at all", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([{ id: openId, title: "running over there", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    confirmSpy.mockRestore();
  });

  it("resumes a not-open-elsewhere session without any confirm", async () => {
    const id = "77777777-7777-7777-7777-777777777777";
    mockFetch([{ id, title: "fix the parser", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm");
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: ["other-id"] });
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(w.findComponent({ name: "TerminalView" }).props("sessionId")).toBe(id);
    confirmSpy.mockRestore();
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
    const items = w.findAll('[data-testid="cell-script-item"]');
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Build");
    await items[0].trigger("click");
    expect(w.emitted("run")?.[0]?.[0]).toEqual({ source: "script", index: 0, label: "Build", cwd: "/home/me/proj" });
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

    expect(w.find('[data-testid="cell-prompt"]').text()).toBe("refactor the parser");
    expect(urls.some((u) => u.includes(`/api/session/${id}`) && u.includes("cwd=%2Fhome%2Fme%2Fproj"))).toBe(true);
  });

  it("shows no resume list when the dir has no sessions", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(w.find('[data-testid="cell-resume"]').exists()).toBe(false);
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
    const chipB = w.findAll('[data-testid="cell-chip"]').find((c) => c.find('[data-testid="cell-chip-main"]').text() === "B");
    if (!chipB) throw new Error("preset B not found");
    await chipB.find('[data-testid="cell-chip-main"]').trigger("click"); // main click = fillDir → fetch #2 (dir B)

    second.resolve({ ok: true, json: async () => ({ cwd: "/B", sessions: [{ id: "b-id", title: "B-sess", mtime: 1 }] }) });
    await flushPromises();
    first.resolve({ ok: true, json: async () => ({ cwd: "/A", sessions: [{ id: "a-id", title: "A-sess", mtime: 1 }] }) });
    await flushPromises();

    expect(w.findAll('[data-testid="ri-title"]').map((x) => x.text())).toEqual(["B-sess"]);
  });

  it("resumes with the resolved cwd from the API, not the typed input", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/api/sessions"))
        return Promise.resolve({ ok: true, json: async () => ({ cwd: "/resolved", sessions: [{ id: "id1", title: "t", mtime: Date.now() }] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell(null, { defaultCwd: "/typed" });
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(w.findComponent({ name: "TerminalView" }).props("cwd")).toBe("/resolved");
  });

  it("clicking a preset chip's main button fills the dir WITHOUT launching (so the user can resume or start)", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const main = w.findAll('[data-testid="cell-chip-main"]').find((b) => b.text() === "proj");
    if (!main) throw new Error("preset chip not found");
    await main.trigger("click");
    // No terminal — the main click only selects the directory (fill, not launch).
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/work/proj");
  });

  it("the chip's ▶ launch button quick-starts a fresh session in its dir", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll('[data-testid="cell-chip"]').find((c) => c.find('[data-testid="cell-chip-main"]').text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find('[data-testid="cell-chip-launch"]').trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/work/proj");
  });

  it("filling a dir from a preset loads its sessions once — the debounced watch doesn't double-fetch", async () => {
    vi.useFakeTimers();
    try {
      const w = mountCell(null, { defaultCwd: "/def", presets: [{ label: "x", path: "/x" }] });
      await flushPromises(); // settle the mount's own (immediate) load
      const sessionCalls = () =>
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/api/sessions")).length;
      const before = sessionCalls();

      const main = w.findAll('[data-testid="cell-chip-main"]').find((b) => b.text() === "x");
      if (!main) throw new Error("preset chip not found");
      await main.trigger("click"); // fillDir → one immediate /api/sessions load
      await flushPromises();
      const immediate = sessionCalls() - before;

      await vi.advanceTimersByTimeAsync(400); // let any debounced watch fire
      await flushPromises();
      const total = sessionCalls() - before;

      expect(immediate).toBe(1); // loaded immediately on click
      expect(total).toBe(1); // and the 300ms watch did NOT re-fetch
    } finally {
      vi.useRealTimers();
    }
  });

  it("a preset fill cancels a pending typed-dir debounce (type-then-click doesn't double-fetch)", async () => {
    vi.useFakeTimers();
    try {
      const w = mountCell(null, { defaultCwd: "/def", presets: [{ label: "x", path: "/x" }] });
      await flushPromises();
      // The URLs, not just the count: this assertion fails intermittently on a loaded CI
      // runner, and "expected 2 to be 1" says nothing about WHY. WHICH dir the extra fetch
      // asked for separates the two candidates — `/typed` means the pending debounce was
      // never cancelled, `/x` means something re-scheduled one after the fill.
      const sessionUrls = () =>
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/sessions"));
      const sessionCalls = () => sessionUrls().length;

      await w.find('[data-testid="cell-dir-input"]').setValue("/typed"); // schedules a 300ms debounced load
      const before = sessionCalls();

      const main = w.findAll('[data-testid="cell-chip-main"]').find((b) => b.text() === "x");
      if (!main) throw new Error("preset chip not found");
      await main.trigger("click"); // fillDir → immediate load + must cancel the pending /typed debounce
      await flushPromises();
      const afterClick = sessionCalls() - before;

      await vi.advanceTimersByTimeAsync(400); // the stale /typed debounce would fire here if not cancelled
      await flushPromises();
      const total = sessionCalls() - before;

      expect(afterClick, `session fetches so far: ${JSON.stringify(sessionUrls())}`).toBe(1); // the fill's own immediate load
      // The pending typed-dir debounce was cancelled — no second fetch.
      expect(total, `session fetches after the 400ms advance: ${JSON.stringify(sessionUrls())}`).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits record-cwd with the server-confirmed cwd of a fresh launch", async () => {
    // A fresh launch + the server confirming the effective cwd asks the parent to
    // auto-record that dir as a preset (the parent persists it to config).
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/alpha");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/alpha");
    await flushPromises();
    expect(w.emitted("record-cwd")?.at(-1)).toEqual(["/home/me/alpha"]);
  });

  it("emits remove-preset (and does NOT launch) when a chip's ✕ is clicked", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll('[data-testid="cell-chip"]').find((c) => c.find('[data-testid="cell-chip-main"]').text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find('[data-testid="cell-chip-del"]').trigger("click");
    expect(w.emitted("remove-preset")?.at(-1)).toEqual(["/work/proj"]);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
  });

  it("does NOT emit record-cwd when a restored session reports its cwd (only fresh launches)", async () => {
    // A cell restoring a persisted session also gets a server cwd report on connect;
    // that must not record a preset (else reload would re-add dirs by mount order).
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/restored" });
    await flushPromises();
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/restored");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("does NOT emit record-cwd when resuming an existing session from the resume list", async () => {
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "fix the parser", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/proj");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("clears the pending-record flag when a fresh launch is torn down before its cwd arrives", async () => {
    // Race: launch sets the record-next flag, but the user closes before the server
    // reports a cwd; a subsequent resume must NOT inherit that pending record.
    mockFetch([{ id: "77777777-7777-7777-7777-777777777777", title: "t", mtime: Date.now() }]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/fresh");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter"); // flag = true, no cwd yet
    await w.find(".cell-close").trigger("click"); // teardown must clear the flag
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click"); // resume an existing session
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/proj");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("prefills the launch field with the most recent preset (not the server default)", async () => {
    const w = mountCell(null, { presets: [{ label: "last", path: "/home/me/last-used" }], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/last-used");
  });

  it("syncs a late-arriving preset into the pristine launch field (open-before-config-load)", async () => {
    // Cold load: the cell mounts before /api/config resolves, so presets start empty
    // and the field falls back to the server default.
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/default");
    // /api/config resolves, delivering the most-recent preset — the pristine field upgrades.
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/alpha");
  });

  it("does NOT override a user-edited launch field when presets arrive late", async () => {
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/typed");
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/typed");
  });

  it("resets the launch form to the default dir after close", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/picked");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/default");
  });

  it("adopts the EFFECTIVE cwd the server reports (persists/shows that, not the typed one)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("relative/bad/path");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    // Server rejected the bad path and fell back; it reports the real cwd.
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/default");
    await nextTick();
    // The cell persists + displays the effective cwd, not the typed one.
    expect(w.emitted("cwd")?.at(-1)).toEqual(["/home/me/default"]);
    expect(w.find(".cell-dir-path").text()).toBe("~/default");
  });

  it("reflects working / blocked / done pushed for its own session", async () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: true, waiting: false, lastPrompt: "refactor the parser" });
    await nextTick();
    expect(promptText(w)).toBe("refactor the parser");
    expect(dotClass(w)).toContain("is-working");

    // waiting + Notification => blocked (needs input); + Stop => done (unreviewed).
    captured?.({ id, working: false, waiting: true, event: "Notification", lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-blocked");

    captured?.({ id, working: false, waiting: true, event: "Stop", lastPrompt: "refactor the parser" });
    await nextTick();
    expect(dotClass(w)).toContain("is-done");
  });

  it("re-seeds its status from the server on a pub/sub reconnect", async () => {
    // The dropped socket missed the push that would have said "working", so the cell is idle.
    // On reconnect it must re-ask /api/session — not sit idle until the session's next event,
    // which for a long turn is its far-off Stop.
    const id = "33333333-3333-3333-3333-333333333333";
    let working = false;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes(`/api/session/${id}`)) return { ok: true, json: async () => ({ working, waiting: false, lastPrompt: null }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id);
    await flushPromises();
    expect(dotClass(w)).toContain("is-idle");

    // The server now knows the turn is running; the reconnect re-fetch should pick that up.
    working = true;
    reconnect?.();
    await flushPromises();
    await nextTick();
    expect(dotClass(w)).toContain("is-working");
  });

  it("does not let a reconnect re-seed clobber a push that lands mid-fetch", async () => {
    // The #620 race in one cell: the reconnect fetch reads a stale "working" snapshot, but a
    // "Stop" push arrives before it resolves. The fresher push must win.
    const id = "44444444-4444-4444-4444-444444444444";
    const gate = deferred<boolean>();
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes(`/api/session/${id}`)) {
        await gate.promise; // hold the reconnect seed in flight
        return { ok: true, json: async () => ({ working: true, waiting: false, lastPrompt: null }) };
      }
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id);
    gate.resolve(true); // let the mount seed settle
    await flushPromises();

    // A second gate for the reconnect seed, so a push can land while it is in flight.
    const gate2 = deferred<boolean>();
    (globalThis.fetch as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes(`/api/session/${id}`)) {
        await gate2.promise;
        return { ok: true, json: async () => ({ working: true, waiting: false, lastPrompt: null }) };
      }
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    });

    reconnect?.(); // starts the seed fetch, now blocked on gate2
    captured?.({ id, working: false, waiting: true, event: "Stop" }); // fresher: the turn ended
    await nextTick();
    expect(dotClass(w)).toContain("is-done");

    gate2.resolve(true); // the stale "working" snapshot resolves last — and must be ignored
    await flushPromises();
    await nextTick();
    expect(dotClass(w)).toContain("is-done");
  });

  it("does not let an older seed clobber a newer one when two reconnect re-seeds overlap", async () => {
    // seed-vs-seed (reconnect flaps): the OLDER seed resolves FIRST with a now-stale snapshot,
    // the NEWER one resolves LAST with the current one. Without a per-request token the older
    // applies first and the newer is then dropped by the push-guard — leaving the stale value.
    const id = "55555555-5555-5555-5555-555555555555";
    const gates = [deferred<boolean>(), deferred<boolean>()];
    let call = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes(`/api/session/${id}`)) {
        const n = call++;
        if (n === 0) return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) }; // mount
        await gates[n - 1].promise;
        // seed #1 => working (stale), seed #2 => idle (current, the turn has since ended).
        return { ok: true, json: async () => ({ working: n === 1, waiting: false, lastPrompt: null }) };
      }
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id);
    await flushPromises();

    reconnect?.(); // seed #1 (older) — reports working
    reconnect?.(); // seed #2 (newer) — reports idle
    gates[0].resolve(true); // OLDER resolves first
    await flushPromises();
    gates[1].resolve(true); // NEWER resolves last
    await flushPromises();
    await nextTick();
    expect(dotClass(w)).toContain("is-idle"); // the newest seed wins, not the first to resolve
  });

  it("shows a token-usage badge for agents that keep it in the pane header", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return {
        ok: true,
        json: async () => ({
          working: false,
          waiting: false,
          lastPrompt: null,
          usage: { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 800, cacheCreationTokens: 0 },
        }),
      };
    }) as unknown as typeof fetch;
    const w = mountCell(id, { initialAgent: "antigravity" });
    await flushPromises();
    const badge = w.find('[data-testid="cell-usage"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("2.0k"); // input 1200 + cacheRead 800 = 2000
    expect(badge.text()).toContain("3.4k"); // output 3400
  });

  it.each(["claude", "codex"] as const)("hides the token-usage badge for %s", async (initialAgent) => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return {
        ok: true,
        json: async () => ({
          working: false,
          waiting: false,
          lastPrompt: null,
          usage: { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 800, cacheCreationTokens: 0 },
        }),
      };
    }) as unknown as typeof fetch;

    const w = mountCell(id, { initialAgent });
    await flushPromises();
    expect(w.find('[data-testid="cell-usage"]').exists()).toBe(false);
  });

  // Codex on #642: a guard that only skips an unrenderable payload leaves the badge showing
  // the previous turn's numbers as if they were current. The server always sends both fields
  // (zeroed when it has nothing to report), so an unrenderable one means something is broken
  // — and the honest answer is to stop claiming a number.
  it("hides the usage badge when a later payload is unrenderable", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    let usage: unknown = { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 800, cacheCreationTokens: 0 };
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, usage }) };
    }) as unknown as typeof fetch;
    const w = mountCell(id, { initialAgent: "antigravity" });
    await flushPromises();
    expect(w.find('[data-testid="cell-usage"]').exists()).toBe(true);

    // A field the server could not compute. The refresh fires on working → settled.
    usage = { inputTokens: 1200, outputTokens: null, cacheReadTokens: 800, cacheCreationTokens: 0 };
    captured?.({ id, working: true, waiting: false });
    await flushPromises();
    captured?.({ id, working: false, waiting: false, event: "Stop" });
    await flushPromises();

    expect(w.find('[data-testid="cell-usage"]').exists()).toBe(false);
  });

  // #620, on the badge path: two turns end back-to-back, so two /api/session reads for the
  // same session are in flight at once. The older one resolving last must not put the
  // previous turn's context reading back on the badge.
  it("does not let a stale badge refresh clobber a newer one (out-of-order)", async () => {
    const id = "66666666-6666-6666-6666-666666666666";
    const gates = [deferred<boolean>(), deferred<boolean>()];
    let sessionCall = 0;
    const badge = (contextTokens: number) => ({
      usage: { inputTokens: contextTokens, outputTokens: contextTokens, cacheReadTokens: 0, cacheCreationTokens: 0 },
      context: { model: "claude-opus-4-8", contextTokens, contextWindow: 10_000 },
    });
    const INITIAL = badge(100);
    const OLD = badge(1000);
    const NEW = badge(5000);
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes(`/api/session/${id}`)) {
        const n = sessionCall++;
        if (n === 0) return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, ...INITIAL }) }; // mount seed
        const badges = n === 1 ? OLD : NEW; // refresh #1 = older turn, refresh #2 = newer turn
        await gates[n - 1].promise;
        return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, ...badges }) };
      }
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id);
    await flushPromises();
    expect(w.find('[data-testid="model-badge"]').text()).toContain("ctx 1%"); // initial seed

    // First turn ends → refresh #1 (older), held on gates[0].
    captured?.({ id, working: true, waiting: false });
    await flushPromises();
    captured?.({ id, working: false, waiting: false, event: "Stop" });
    await flushPromises();
    // Second turn ends → refresh #2 (newer), held on gates[1].
    captured?.({ id, working: true, waiting: false });
    await flushPromises();
    captured?.({ id, working: false, waiting: false, event: "Stop" });
    await flushPromises();

    gates[1].resolve(true); // newer resolves first → applies the current turn's numbers
    await flushPromises();
    gates[0].resolve(true); // older resolves last → must be ignored, not revive the prior turn
    await flushPromises();
    await nextTick();

    const modelBadge = w.find('[data-testid="model-badge"]').text();
    expect(modelBadge).toContain("ctx 50%"); // NEW context
    expect(modelBadge).not.toContain("ctx 10%"); // not OLD context
  });

  it("shows the model/context badge from /api/session/:id context", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return {
        ok: true,
        json: async () => ({ working: false, waiting: false, lastPrompt: null, context: { model: "claude-opus-4-20250514", contextTokens: 70_000 } }),
      };
    }) as unknown as typeof fetch;
    const w = mountCell(id);
    await flushPromises();
    const badge = w.find('[data-testid="model-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("Opus · ctx 35%"); // 70k / 200k
  });

  // An agy cell is the case that has no other way back: agy mints its conversation id after the
  // spawn, so the seed fetch can only answer "no model" — and with no hooks and no activity
  // tracker it never finishes a turn, which is the cell's only other badge refresh. The server
  // publishes when it captures the id (spawn-antigravity.ts); this is the other half.
  it("re-reads the badges on a push while the model is still unknown", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    let model: string | null = null;
    let detailReads = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (SESSION_DETAIL_RE.test(u)) detailReads++;
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, context: { model, contextTokens: 0 } }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id, { initialAgent: "antigravity" });
    await flushPromises();
    expect(w.find('[data-testid="model-badge"]').exists()).toBe(false); // agy has not created the conversation yet
    // The seed applies activity BEFORE badges, so a re-ask hung off that path would fire here for
    // the answer it already has — on every non-claude cell, every load.
    expect(detailReads).toBe(1);

    model = "Gemini 3.6 Flash (High)"; // the capture landed, so the transcript now names it
    captured?.({ id, working: false, waiting: false });
    await flushPromises();
    await nextTick();
    expect(w.find('[data-testid="model-badge"]').text()).toBe("Gemini 3.6 Flash");

    // And it stops: a known model is not asked for again on the next push.
    const settled = detailReads;
    captured?.({ id, working: false, waiting: false });
    await flushPromises();
    expect(detailReads).toBe(settled);
  });

  // agy's and grok's context readings move every turn, and neither agent has a turn end to hang a
  // refresh on — so without this the percentage is frozen at whatever it was when the cell first
  // asked. Claude and codex both settle a turn, and must not become pollers.
  it("re-reads an untracked cell's badges on a timer, and no tracked agent's", async () => {
    vi.useFakeTimers();
    try {
      const id = "55555555-5555-5555-5555-555555555555";
      let detailReads = 0;
      globalThis.fetch = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
        if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
        if (SESSION_DETAIL_RE.test(u)) detailReads++;
        return {
          ok: true,
          json: async () => ({
            working: false,
            waiting: false,
            lastPrompt: null,
            context: { model: "Gemini 3.6 Flash", contextTokens: 1000, contextWindow: 256_000 },
          }),
        };
      }) as unknown as typeof fetch;

      for (const untracked of ["antigravity", "grok"] as const) {
        const w = mountCell(id, { initialAgent: untracked });
        await vi.advanceTimersByTimeAsync(1);
        const afterMount = detailReads;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(detailReads, untracked).toBeGreaterThan(afterMount);
        w.unmount();
      }

      for (const tracked of ["claude", "codex"] as const) {
        const w = mountCell(id, { initialAgent: tracked });
        await vi.advanceTimersByTimeAsync(1);
        const settled = detailReads;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(detailReads, tracked).toBe(settled);
        w.unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Claude's badges ride along with the summary the route already folds, and this is the busiest
  // route in the app — a push must not turn every claude cell into a poller.
  it("does not re-read the badges on a push for a claude cell", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    let detailReads = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (SESSION_DETAIL_RE.test(u)) detailReads++;
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, context: { model: null, contextTokens: 0 } }) };
    }) as unknown as typeof fetch;

    const w = mountCell(id);
    await flushPromises();
    const settled = detailReads;
    captured?.({ id, working: true, waiting: false });
    await flushPromises();
    expect(detailReads).toBe(settled);
    expect(w.find('[data-testid="model-badge"]').exists()).toBe(false);
  });

  it("renders configured chips: hides an omitted built-in, keeps a listed one, and shows custom text", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      // chips lists usage + a custom chip, but NOT ctx — so the model badge must be hidden even though context is set.
      if (u.includes("/api/header"))
        return {
          ok: true,
          json: async () => ({
            buttons: [],
            chips: [
              { kind: "builtin", id: "usage" },
              { kind: "custom", label: "env", text: "prod" },
            ],
          }),
        };
      return {
        ok: true,
        json: async () => ({
          working: false,
          waiting: false,
          lastPrompt: null,
          usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 },
          context: { model: "claude-opus-4-8", contextTokens: 70_000 },
        }),
      };
    }) as unknown as typeof fetch;
    const w = mountCell(id, { initialCwd: "/home/me/proj", initialAgent: "antigravity" });
    await flushPromises();
    expect(w.find('[data-testid="cell-hdr-chip"]').text()).toBe("prod"); // custom chip renders its substituted text
    expect(w.find('[data-testid="cell-usage"]').exists()).toBe(true); // usage is listed
    expect(w.find('[data-testid="model-badge"]').exists()).toBe(false); // ctx omitted from the list → hidden despite context set
  });

  it("renders duplicate built-in chips without key collisions", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/p", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes("/api/header"))
        return {
          ok: true,
          json: async () => ({
            buttons: [],
            chips: [
              { kind: "builtin", id: "usage" },
              { kind: "builtin", id: "usage" },
            ],
          }),
        };
      return {
        ok: true,
        json: async () => ({
          working: false,
          waiting: false,
          lastPrompt: null,
          usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 },
          context: { model: "claude-opus-4-8", contextTokens: 1 },
        }),
      };
    }) as unknown as typeof fetch;
    const w = mountCell(id, { initialCwd: "/home/me/proj", initialAgent: "antigravity" });
    await flushPromises();
    expect(w.findAll('[data-testid="cell-usage"]')).toHaveLength(2); // both duplicates render, unique keys → no collision
  });

  it("shows no model badge when the session has no model yet", async () => {
    const id = "55555555-5555-5555-5555-555555555555";
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, context: { model: null, contextTokens: 0 } }) };
    }) as unknown as typeof fetch;
    const w = mountCell(id);
    await flushPromises();
    expect(w.find('[data-testid="model-badge"]').exists()).toBe(false);
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

  it("prefers the AI title over the raw prompt in the header, and falls back when it clears", async () => {
    const id = "66666666-6666-6666-6666-666666666666";
    const w = mountCell(id);
    await flushPromises();
    captured?.({ id, working: false, waiting: false, lastPrompt: "2番目にして", aiTitle: "パーサー修正" });
    await nextTick();
    expect(promptText(w)).toBe("パーサー修正");

    // Dropping the title (null) falls back to the raw prompt, not a stale title.
    captured?.({ id, working: false, waiting: false, lastPrompt: "2番目にして", aiTitle: null });
    await nextTick();
    expect(promptText(w)).toBe("2番目にして");
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

  // The GitHub items live in the PATH MENU now — the separate GitHub button is gone, along with
  // the `gh` default header button. `openPathMenu` returns the menu's item labels so a test can
  // assert on what the menu offers rather than on which button rendered.
  // Each item leads with a Material Symbols ligature, which renders as its own text node — so the
  // icon name is stripped to leave the label a reader would see.
  const itemLabel = (text: string) => text.replace(/^\S+\s+/, "");
  const openPathMenu = async (w: ReturnType<typeof mountCell>) => {
    await w.find(".cell-dir").trigger("click");
    return w.findAll('[data-testid="cell-path-item"]').map((b) => itemLabel(b.text()));
  };

  it("offers the GitHub destinations in the path menu when the dir is a GitHub repo", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(await openPathMenu(w)).toEqual([
      "Reveal in the file manager",
      "Browse files in the app",
      "New terminal here",
      "Repository",
      "Issues",
      "Pull requests",
    ]);
  });

  it("keeps the GitHub destinations out of the menu for a non-GitHub repo (null) and on lookup failure", async () => {
    const local = ["Reveal in the file manager", "Browse files in the app", "New terminal here"];
    mockFetchWithGithub(null);
    const a = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(await openPathMenu(a)).toEqual(local);

    mockFetchWithGithub("https://github.com/owner/repo", false); // res.ok = false
    const b = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(await openPathMenu(b)).toEqual(local);
  });

  it("opens repository / issues / pull requests from the path menu", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();

    const openItem = async (label: string) => {
      await w.find(".cell-dir").trigger("click");
      const item = w.findAll('[data-testid="cell-path-item"]').find((b) => itemLabel(b.text()) === label);
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

  it("toggles the path menu and closes it on Escape", async () => {
    mockFetchWithGithub("https://github.com/owner/repo");
    const w = mountCell("33333333-3333-3333-3333-333333333333", { initialCwd: "/home/me/repo" });
    await flushPromises();
    expect(w.find('[data-testid="cell-path-menu"]').exists()).toBe(false);
    await w.find(".cell-dir").trigger("click");
    expect(w.find('[data-testid="cell-path-menu"]').exists()).toBe(true);
    // Escape is pressed ON THE TRIGGER, which is where focus actually is after opening the menu
    // with the mouse or the keyboard. A handler bound to the menu itself passes a test that
    // dispatches the key at the menu and does nothing at all for a real user (codex review, #1382).
    await w.find(".cell-dir").trigger("keydown", { key: "Escape" });
    expect(w.find('[data-testid="cell-path-menu"]').exists()).toBe(false);
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
    await w.find(".cell-dir").trigger("click");
    await w
      .findAll('[data-testid="cell-path-item"]')
      .find((b) => itemLabel(b.text()) === "Repository")
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
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);
    const rows = w.findAll('[data-testid="worktree-reuse"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("fix-login");
  });

  it("hides the worktree section for a non-git dir", async () => {
    mockFetch(); // default mock reports no isGit
    const w = mountCell(null, { defaultCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(false);
  });

  it("creates a worktree for the typed task and launches claude in it", async () => {
    const posts = mockFetchWithWorktrees([], { path: "/wt/fix-login", branch: "agent/fix-login" });
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    await w.find('[data-testid="wt-task"]').setValue("fix login");
    await w.find('[data-testid="wt-start"]').trigger("click");
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
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    await w.find('[data-testid="worktree-reuse"]').trigger("click");
    // The launch waits on the tool-group sync — one read of the worktree's registrations, plus a
    // write per group that disagrees with the launcher (syncMcpGroupsInto).
    await flushPromises();
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/wt/old-task");
  });

  it("removes a clean worktree (deleteBranch, no force) without confirming", async () => {
    const posts = mockFetchWithWorktrees([{ path: "/wt/done", branch: "agent/done", task: "done", dirty: false }]);
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    await w.find('[data-testid="wt-del"]').trigger("click");
    await flushPromises();
    const remove = posts.find((p) => p.url.includes("/api/worktrees/remove"));
    if (!remove) throw new Error("remove not called");
    expect(JSON.parse(remove.body)).toEqual({ repoDir: "/home/me/repo", path: "/wt/done", deleteBranch: true, force: false });
  });

  it("confirms before removing a DIRTY worktree, and forces when confirmed", async () => {
    const posts = mockFetchWithWorktrees([{ path: "/wt/wip", branch: "agent/wip", task: "wip", dirty: true }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    expect(w.find('[data-testid="wt-dirty"]').exists()).toBe(true); // the ● uncommitted-changes marker
    await w.find('[data-testid="wt-del"]').trigger("click");
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
    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    await w.find('[data-testid="wt-del"]').trigger("click");
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

    const badge = w.find('[data-testid="cell-wt-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.find('[data-testid="wt-ahead"]').text()).toBe("+3");
    expect(badge.find('[data-testid="wt-dirty-count"]').text()).toBe("●2");

    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false); // panel closed initially
    await badge.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="cell-diff-file"]')).toHaveLength(2);
    // Paths clip from the front here too, so the filename is what survives a narrow panel.
    expect(w.findAll('[data-testid="cell-diff-file"]')[0].get("span").classes()).toEqual(expect.arrayContaining(["truncate", "text-left", "[direction:rtl]"]));
    expect(w.find('[data-testid="df-new"]').exists()).toBe(true); // the untracked file
    expect(w.find('[data-testid="cell-diff-patch"]').text()).toContain("hello");

    await w.find('[data-testid="cell-diff"] .cell-btn').trigger("click"); // ✕ closes it
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false);
  });

  it("shows no diff badge for a clean worktree (0 ahead / 0 dirty)", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 0, dirty: 0, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(false);
  });

  it("never shows the diff badge for a non-worktree cell", async () => {
    mockFetchWithDiff({ isWorktree: false, base: null, ahead: 9, dirty: 9, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/regular-proj" });
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(false);
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
    await w.find('[data-testid="cell-resume-item"]').trigger("click"); // resume the idle worktree session
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="wt-ahead"]').text()).toBe("+2");
  });

  it("clears the diff badge when the cwd falls back to a non-worktree dir", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 3, dirty: 1, files: [], patch: "", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(true);
    // server confirms a different, non-worktree dir → badge must not linger
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/plain-proj");
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(false);
  });

  it("auto-closes the open diff panel when the cwd leaves the worktree (no empty overlay)", async () => {
    mockFetchWithDiff({
      isWorktree: true,
      base: "main",
      ahead: 3,
      dirty: 1,
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
      patch: "x",
      truncated: false,
    });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find('[data-testid="cell-wt-badge"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(true);
    // leaving the worktree clears `diff`; the panel must not linger as an empty overlay
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/plain-proj");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false);
  });

  it("does not auto-reopen the diff panel after leaving and re-entering a worktree", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 2, dirty: 0, files: [], patch: "x", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find('[data-testid="cell-wt-badge"]').trigger("click"); // user opens the panel
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(true);

    const term = w.findComponent({ name: "TerminalView" });
    term.vm.$emit("cwd", "/home/me/plain-proj"); // leave the worktree → panel closes
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false);

    term.vm.$emit("cwd", WT_CWD); // re-enter a worktree
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(true); // badge returns…
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false); // …but the panel stays closed until clicked
  });

  it("closes the diff panel on Escape (document-level handler)", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 1, dirty: 0, files: [], patch: "x", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find('[data-testid="cell-wt-badge"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // focus may be on the badge/terminal
    await flushPromises();
    expect(w.find('[data-testid="cell-diff"]').exists()).toBe(false);
  });

  it("ignores an in-flight diff fetch that resolves after the cwd left the worktree", async () => {
    const diffFetch = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    globalThis.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/diff")) return diffFetch.promise;
      if (u.includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises(); // the worktree diff fetch is in flight (pending)
    // leave the worktree BEFORE it resolves — the clear path must invalidate the token
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/plain-proj");
    await flushPromises();
    // the stale worktree diff now resolves — it must not repopulate the badge
    diffFetch.resolve({ ok: true, json: async () => ({ isWorktree: true, base: "main", ahead: 5, dirty: 5, files: [], patch: "", truncated: false }) });
    await flushPromises();
    expect(w.find('[data-testid="cell-wt-badge"]').exists()).toBe(false);
  });

  // Slice 2 — push / open-PR actions in the diff panel footer.
  function mockFetchWithPr(diff: Record<string, unknown>, action: { url?: string; status?: number; body: Record<string, unknown> }) {
    const posts: { url: string; body: string }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === "POST") posts.push({ url: u, body: String(init.body ?? "") });
      if (u.includes("/api/worktrees/push") || u.includes("/api/worktrees/pr"))
        return { ok: (action.status ?? 200) < 400, status: action.status ?? 200, json: async () => action.body };
      if (u.includes("/api/worktrees/diff")) return { ok: true, json: async () => diff };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    return posts;
  }
  const aheadDiff = (ahead: number) => ({
    isWorktree: true,
    base: "main",
    ahead,
    dirty: 0,
    files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
    patch: "x",
    truncated: false,
  });
  const openPanel = async (w: ReturnType<typeof mountCell>) => {
    await w.find('[data-testid="cell-wt-badge"]').trigger("click");
    await flushPromises();
  };

  it("disables Push / Open PR when there are no commits ahead (only uncommitted changes)", async () => {
    // ahead 0 but dirty 2 → badge shows (via dirty), but nothing is committed to push
    mockFetchWithPr(
      {
        isWorktree: true,
        base: "main",
        ahead: 0,
        dirty: 2,
        files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
        patch: "x",
        truncated: false,
      },
      { body: { ok: true } },
    );
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const btns = w.findAll('[data-testid="cell-diff-btn"]');
    const labelled = (text: string) => btns.find((b) => b.text().includes(text));
    expect(labelled("Push")?.attributes("disabled")).toBeDefined(); // no commits ahead
    expect(labelled("Open PR")?.attributes("disabled")).toBeDefined();
    expect(labelled("Commit")?.attributes("disabled")).toBeUndefined(); // but there ARE uncommitted changes to commit
  });

  it("Push posts to /api/worktrees/push and shows the pushed branch", async () => {
    const posts = mockFetchWithPr(aheadDiff(2), { body: { ok: true, branch: "agent/fix-login" } });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const push = w.findAll('[data-testid="cell-diff-btn"]').find((b) => b.text().includes("Push"));
    if (!push) throw new Error("Push button not found");
    await push.trigger("click");
    await flushPromises();
    const req = posts.find((p) => p.url.includes("/api/worktrees/push"));
    if (!req) throw new Error("push not called");
    expect(JSON.parse(req.body)).toEqual({ cwd: WT_CWD });
    expect(w.find('[data-testid="cell-diff-msg"]').text()).toBe("Pushed agent/fix-login");
  });

  it("Open PR opens the returned url in a new tab", async () => {
    mockFetchWithPr(aheadDiff(2), { body: { ok: true, url: "https://github.com/owner/repo/pull/9", via: "cli" } });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const pr = w.findAll('[data-testid="cell-diff-btn"]').find((b) => b.text().includes("Open PR"));
    if (!pr) throw new Error("Open PR button not found");
    await pr.trigger("click");
    await flushPromises();
    expect(openSpy).toHaveBeenCalledWith("https://github.com/owner/repo/pull/9", "_blank", "noopener,noreferrer");
    expect(w.find('[data-testid="cell-diff-msg"]').text()).toBe("PR created");
    openSpy.mockRestore();
  });

  it("shows a friendly message when push fails with no remote (409)", async () => {
    mockFetchWithPr(aheadDiff(2), { status: 409, body: { ok: false, reason: "no-remote" } });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const push = w.findAll('[data-testid="cell-diff-btn"]').find((b) => b.text().includes("Push"));
    await push?.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff-msg"]').text()).toContain("No git remote");
  });

  const commitBtn = (w: ReturnType<typeof mountCell>) => w.findAll('[data-testid="cell-diff-btn"]').find((b) => b.text().includes("Commit"));

  it("Commit asks the Claude session to commit when there are uncommitted changes", async () => {
    // ahead 0, dirty 2 → the badge shows (dirty) and the Commit button is enabled
    mockFetchWithPr(
      {
        isWorktree: true,
        base: "main",
        ahead: 0,
        dirty: 2,
        files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
        patch: "x",
        truncated: false,
      },
      { body: { ok: true } },
    );
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const term = w.findComponent({ name: "TerminalView" });
    const submit = vi.spyOn(term.vm as unknown as { submitText: (t: string) => boolean }, "submitText");

    const commit = commitBtn(w);
    if (!commit) throw new Error("Commit button not found");
    expect(commit.attributes("disabled")).toBeUndefined(); // enabled (dirty>0, not working)
    await commit.trigger("click");
    await flushPromises();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toContain("Commit all current changes");
    expect(w.find('[data-testid="cell-diff-msg"]').text()).toContain("Asked Claude to commit");
  });

  it("disables Commit when there are no uncommitted changes (dirty=0)", async () => {
    mockFetchWithPr(aheadDiff(2), { body: { ok: true } }); // ahead 2, dirty 0
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    expect(commitBtn(w)?.attributes("disabled")).toBeDefined();
  });

  it("disables Commit while the session is working (don't interrupt the agent)", async () => {
    mockFetchWithPr(
      {
        isWorktree: true,
        base: "main",
        ahead: 0,
        dirty: 2,
        files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
        patch: "x",
        truncated: false,
      },
      { body: { ok: true } },
    );
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    captured?.({ id: "66666666-6666-6666-6666-666666666666", working: true, waiting: false }); // agent starts working
    await nextTick();
    expect(commitBtn(w)?.attributes("disabled")).toBeDefined();
  });

  it("shows a fallback message when the session can't be reached", async () => {
    mockFetchWithPr(
      {
        isWorktree: true,
        base: "main",
        ahead: 0,
        dirty: 2,
        files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
        patch: "x",
        truncated: false,
      },
      { body: { ok: true } },
    );
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const term = w.findComponent({ name: "TerminalView" });
    vi.spyOn(term.vm as unknown as { submitText: (t: string) => boolean }, "submitText").mockReturnValue(false);
    await commitBtn(w)?.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-diff-msg"]').text()).toContain("Couldn't reach the session");
  });

  it("does not get stuck on 'Pushing…' when the response has no JSON body (403)", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/push"))
        return {
          ok: false,
          status: 403,
          json: async () => {
            throw new Error("empty body");
          },
        };
      if (u.includes("/api/worktrees/diff")) return { ok: true, json: async () => aheadDiff(2) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const push = w.findAll('[data-testid="cell-diff-btn"]').find((b) => b.text().includes("Push"));
    await push?.trigger("click");
    await flushPromises();
    const msg = w.find('[data-testid="cell-diff-msg"]').text();
    expect(msg).not.toBe("Pushing…");
    expect(msg).toContain("Not allowed");
  });

  // Close-time cleanup: closing a worktree cell asks to keep or remove the room.
  function mockFetchCloseCleanup(diff: Record<string, unknown>) {
    const posts: { url: string; body: string }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (init?.method === "POST") posts.push({ url: u, body: String(init.body ?? "") });
      if (u.includes("/api/worktrees/remove")) return { ok: true, json: async () => ({ ok: true }) };
      if (u.includes("/api/worktrees/diff")) return { ok: true, json: async () => diff };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    return posts;
  }
  const cleanWtDiff = { isWorktree: true, base: "main", ahead: 0, dirty: 0, files: [], patch: "", truncated: false };

  it("closing a worktree cell asks to keep or remove the room (no immediate teardown)", async () => {
    mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(true);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(true); // session not torn down yet
  });

  it("a NON-worktree cell still closes immediately (no confirm)", async () => {
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/plain-proj" });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true); // torn down to the launcher
  });

  it("Keep worktree tears the cell down WITHOUT removing the room", async () => {
    const posts = mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await w.find('[data-testid="ccx-keep"]').trigger("click");
    await flushPromises();
    expect(posts.some((p) => p.url.includes("/api/worktrees/remove"))).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("Remove worktree posts a forced remove (path+repoDir = the worktree) then closes", async () => {
    const posts = mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await flushPromises(); // the close() diff refresh enables the Remove button
    await w.find('[data-testid="ccx-remove"]').trigger("click");
    await flushPromises();
    const rm = posts.find((p) => p.url.includes("/api/worktrees/remove"));
    if (!rm) throw new Error("remove not called");
    expect(JSON.parse(rm.body)).toMatchObject({ repoDir: WT_CWD, path: WT_CWD, deleteBranch: true, force: true });
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("holds Remove (Checking…) until the fresh diff load completes", async () => {
    const gate = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    let diffCalls = 0;
    globalThis.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/diff")) {
        diffCalls += 1;
        // first call (on mount) resolves; the close() refresh (2nd) is gated
        return diffCalls >= 2 ? gate.promise : Promise.resolve({ ok: true, json: async () => cleanWtDiff });
      }
      if (u.includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click"); // close() refresh is pending on `gate`
    await nextTick();
    expect(w.find('[data-testid="ccx-remove"]').attributes("disabled")).toBeDefined(); // held while checking
    gate.resolve({ ok: true, json: async () => cleanWtDiff });
    await flushPromises();
    expect(w.find('[data-testid="ccx-remove"]').attributes("disabled")).toBeUndefined(); // released
  });

  it("keeps the confirm open with an error when the remove fails (no false success)", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/worktrees/remove")) return { ok: false, status: 500, json: async () => ({ ok: false, reason: "failed" }) };
      if (u.includes("/api/worktrees/diff")) return { ok: true, json: async () => cleanWtDiff };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await flushPromises();
    await w.find('[data-testid="ccx-remove"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(true); // NOT torn down
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(false);
    expect(w.find('[data-testid="ccx-warn"]').text()).toContain("Couldn't remove");
  });

  it("Escape dismisses the close confirmation", async () => {
    mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(true);
  });

  it("Cancel keeps the session running", async () => {
    mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await w.find('[data-testid="ccx-cancel"]').trigger("click");
    expect(w.find('[data-testid="cell-close-confirm"]').exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(true);
  });

  it("warns about unsaved work (unpushed + uncommitted) and labels the button Discard", async () => {
    mockFetchCloseCleanup({
      isWorktree: true,
      base: "main",
      ahead: 2,
      dirty: 1,
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "changed" }],
      patch: "x",
      truncated: false,
    });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await flushPromises(); // the close() diff refresh
    const warn = w.find('[data-testid="ccx-warn"]');
    expect(warn.exists()).toBe(true);
    expect(warn.text()).toContain("2 unpushed");
    expect(warn.text()).toContain("1 uncommitted");
    expect(w.find('[data-testid="ccx-remove"]').text()).toContain("Discard");
  });

  it("keeps the CELL's own controls on row 1 (cell-header); the SESSION's actions live on row 2", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", reorderable: true });
    await flushPromises();
    // Row 1 (cell-header): dir + prompt, and the controls that act on the cell itself — reorder,
    // expand, close. They have to be here rather than on row 2: row 2 is the session's header and
    // is hidden entirely on a filmstrip thumbnail.
    const header = w.find(".cell-header");
    expect(header.find(".cell-close").exists()).toBe(true);
    expect(header.find('[aria-label="Expand terminal"]').exists()).toBe(true);
    expect(header.find('[aria-label="Move terminal left"]').exists()).toBe(true);
    expect(header.find('[aria-label="Move terminal right"]').exists()).toBe(true);
    // The timeline / GitHub icons act on the running session, so they stay on row 2 (the
    // TerminalView slot).
    expect(header.find('[aria-label="Show activity timeline"]').exists()).toBe(false);
    expect(w.find('[aria-label="Show activity timeline"]').exists()).toBe(true);
  });

  it("puts reorder with the other cell controls, before expand", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", reorderable: true });
    await flushPromises();
    const labels = w.findAll(".cell-header > .cell-actions button").map((b) => b.attributes("aria-label"));
    expect(labels).toEqual(["Move terminal left", "Move terminal right", "Expand terminal", "Set aside (stays open, keeps its history)", "Close terminal"]);
  });

  it("drops reorder when the grid is not reorderable", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find('[aria-label="Move terminal left"]').exists()).toBe(false);
  });

  // The note pencil, the unread-canvas count and the diff badge are one family: pressable chips
  // that sit INSIDE the info track. They must stay chip-sized rather than CELL_BTN-sized, or the
  // header's height would depend on whether a cell happens to have a note. The three drifted apart
  // when each wrote its own class string, which read as the pencil being styled by mistake.
  it("styles the info track's pressable chips as one family", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    const pencil = w.find('[data-testid="cell-memo-edit"]');
    expect(pencil.exists()).toBe(true);
    for (const cls of CELL_CHIP_BTN.split(" ")) expect(pencil.classes()).toContain(cls);
    // Chip-sized, not CELL_BTN-sized: the fixed box is what would change the header's height.
    expect(pencil.classes()).not.toContain("h-[26px]");
    // Its ink is the one thing it does NOT share — the pencil says whether a note exists.
    expect(pencil.classes()).toContain("text-dim");
    expect(pencil.find("span").classes().join(" ")).toBe(CELL_CHIP_ICON);
  });

  it("pins expand + close outside the info track so crowded header info can't push them off", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    // The info (dot / chips / prompt) lives in the shrinkable, clipping track…
    expect(w.find('.cell-header > [data-testid="cell-header-main"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-header-main"] [data-testid="cell-prompt"]').exists()).toBe(true);
    // …while the actions are a SIBLING of it, so they can never be pushed out of the cell.
    expect(w.find(".cell-header > .cell-actions").exists()).toBe(true);
    expect(w.find('[data-testid="cell-header-main"] .cell-actions').exists()).toBe(false);
    expect(w.find('.cell-actions [aria-label="Expand terminal"]').exists()).toBe(true);
    expect(w.find(".cell-actions .cell-close").exists()).toBe(true);
  });

  it("shows the restore label + icon when the cell is expanded", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", expanded: true });
    await flushPromises();
    expect(w.find('[aria-label="Restore terminal"]').exists()).toBe(true);
    expect(w.find("button.cell-dir").exists()).toBe(true); // the path menu stays reachable
  });

  it("a filmstrip thumbnail (another cell zoomed) uses the shared roster header, chips stripped", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    // The roster-style header (dir colour applied regardless of status, plus its status badge),
    // NOT the full info header.
    expect(w.find('[data-testid="cockpit-header"]').exists()).toBe(true);
    expect(w.find('[data-testid="cockpit-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-header-main"]').exists()).toBe(false);
    // Info stripped: no git chip / usage / open-dir button; the terminal's own header row is hidden.
    expect(w.find('[data-testid="git-chip"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-usage"]').exists()).toBe(false);
    expect(w.find("button.cell-dir").exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).props("hideHeader")).toBe(true);
    // Expand/close stay available.
    expect(w.find('[aria-label="Expand terminal"]').exists()).toBe(true);
  });

  it("a filmstrip thumbnail's header click zooms (switch to it) instead of opening the dir", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn((url: string) => {
      urls.push(String(url));
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    await w.find('[data-testid="cockpit-header"]').trigger("click");

    expect(w.emitted("toggle-expand")).toHaveLength(1); // zoomed instead
    expect(urls).not.toContain("/api/open-dir"); // dir was NOT opened
  });

  it("zooms on a header-background click in the normal grid (mirrors clicking the body)", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("does not zoom on a header-background click while expanded (restore via the ⤡ button)", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", expanded: true });
    await flushPromises();
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
    // The dedicated restore button still works.
    await w.find('[aria-label="Restore terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  // The header's own click zooms the cell, so a click on one of ITS buttons must not do both.
  // Nothing stops propagation here — shouldZoomOnHeaderClick declines anything inside a
  // button — so these pin the guard from the cell's side, where the two meet (#826).
  it("closes without also zooming when the close button is clicked in the tiled grid", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find(".cell-header").classes()).toContain("is-zoomable"); // the header WOULD zoom
    await w.find(".cell-close").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });

  it("emits toggle-expand once — not twice — when the expand button is clicked in the tiled grid", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1); // the button, not the button + the header
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail (switch to it)", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("applies headerColor/headerTextColor from .mulmoterminal.json as header CSS vars", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config")) return { ok: true, json: async () => ({ headerColor: "#112233", headerTextColor: "#ffffff" }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    // A cwd unique to this test so useDirConfig's per-cwd cache doesn't collide.
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/hdr-color-cell" });
    await flushPromises();
    const style = w.find(".cell-header").attributes("style") ?? "";
    expect(style).toContain("--cell-header-bg: #112233");
    expect(style).toContain("--cell-header-fg: #ffffff");
  });

  it("applies cellColor/cellBorderColor/dotColor/buttonColor as cell-root CSS vars", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config"))
        return { ok: true, json: async () => ({ cellColor: "#101014", cellBorderColor: "#2a2a4e", dotColor: "#00e676", buttonColor: "#c7cdf0" }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/cell-accent" });
    await flushPromises();
    const style = w.find(".cell").attributes("style") ?? "";
    expect(style).toContain("--cell-bg: #101014");
    expect(style).toContain("--cell-border: #2a2a4e");
    expect(style).toContain("--cell-dot: #00e676");
    expect(style).toContain("--cell-btn: #c7cdf0");
    // …and the idle frame must actually CONSUME --cell-border, not just emit it:
    // the border colour lived in a scoped rule until it moved to a utility, and
    // dropping the consumer would silently lose the per-dir tint.
    expect(w.find(".cell").classes()).toContain("border-[var(--cell-border,var(--border))]");
  });

  // The stored preset list is most-recently-used, so its order changes on every launch. The chips
  // are read next to the grid, which sorts by the directory's declared rank — so they follow that
  // instead, and a directory that declares none keeps its stored position behind the ranked ones.
  it("orders preset chips by each directory's orderPriority, leaving unranked dirs last", async () => {
    const rankByDir: Record<string, number> = { "/home/me/ord-b": 10, "/home/me/ord-c": 5 };
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config")) {
        const cwd = decodeURIComponent(new URL(u, "http://localhost").searchParams.get("cwd") ?? "");
        const orderPriority = rankByDir[cwd];
        return { ok: true, json: async () => (orderPriority === undefined ? {} : { orderPriority }) };
      }
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
    const w = mountCell(null, {
      presets: [
        { label: "a", path: "/home/me/ord-a" },
        { label: "b", path: "/home/me/ord-b" },
        { label: "c", path: "/home/me/ord-c" },
        { label: "d", path: "/home/me/ord-d" },
      ],
    });
    await flushPromises();
    // The workspace leads, outside the ranking — it is not one of the directories being ranked
    // against each other (see launchChips). Its label carries the icon's ligature text.
    expect(w.findAll('[data-testid="cell-chip-main"]').map((b) => b.text())).toEqual(["workspacesWORKSPACE", "c", "b", "a", "d"]);
  });

  it("tints a preset chip whose dir already has a running session elsewhere", () => {
    const w = mountCell(null, {
      presets: [
        { label: "proj-a", path: "/home/me/a" },
        { label: "proj-b", path: "/home/me/b" },
      ],
      openCwds: ["/home/me/a"],
    });
    const chips = w.findAll('[data-testid="cell-chip"]');
    const running = chips.find((c) => c.text().includes("proj-a"));
    const idle = chips.find((c) => c.text().includes("proj-b"));
    expect(running?.classes()).toContain("is-running");
    expect(running?.find('[data-testid="cell-chip-dot"]').exists()).toBe(true);
    // a11y: the running state is exposed in text (on the ▶ launch button — the action that
    // would actually double-launch there), not just color/hover.
    expect(running?.find('[data-testid="cell-chip-launch"]').attributes("aria-label")).toContain("already running");
    expect(idle?.classes()).not.toContain("is-running");
    expect(idle?.find('[data-testid="cell-chip-dot"]').exists()).toBe(false);
    expect(idle?.find('[data-testid="cell-chip-launch"]').attributes("aria-label")).not.toContain("already running");
  });

  // Two facts on one chip: "this is that project" and "a session is already running there".
  // The wash is dropped while running so the blue keeps meaning only the second one.
  it("keeps the running chip's blue and carries the dir colour on the stripe alone", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config")) return { ok: true, json: async () => ({ headerColor: "#aa1122" }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(null, { presets: [{ label: "busy", path: "/chip/busy" }], openCwds: ["/chip/busy"] });
    await flushPromises();

    const chip = chipForPath(w, "/chip/busy");
    expect(chip.classes()).toContain("is-running");
    expect(chip.attributes("style") ?? "").not.toContain("#aa1122"); // the blue keeps the background
    expect(chip.find('[data-testid="cell-chip-color"]').attributes("style")).toContain("rgb(170, 17, 34)");
  });

  it("stripes each recent-dir chip with that directory's configured colour, and leaves the rest bare", async () => {
    const byCwd: Record<string, unknown> = { "/chip/tinted": { headerColor: "#aa1122" }, "/chip/bare": { name: "no colour" } };
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config")) {
        const cwd = decodeURIComponent(new URL(u, "https://test.invalid").searchParams.get("cwd") ?? "");
        return { ok: true, json: async () => byCwd[cwd] ?? {} };
      }
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountCell(null, {
      presets: [
        { label: "tinted", path: "/chip/tinted" },
        { label: "bare", path: "/chip/bare" },
      ],
    });
    await flushPromises();

    const chips = w.findAll('[data-testid="cell-chip"]');
    const tinted = chips.find((c) => c.text().includes("tinted"));
    const bare = chips.find((c) => c.text().includes("bare"));
    expect(tinted?.find('[data-testid="cell-chip-color"]').attributes("style")).toContain("rgb(170, 17, 34)");
    // The STRIPE is the whole of it. The chip's own background used to be washed in the same
    // colour, which is exactly what "a session is running here" means — so a colour-coded
    // directory read as running (#1106). One channel, one meaning.
    expect(tinted?.attributes("style") ?? "").not.toContain("background");
    // A directory with nothing configured has to look exactly as it did before the stripe existed.
    expect(bare?.find('[data-testid="cell-chip-color"]').exists()).toBe(false);
    expect(bare?.attributes("style") ?? "").not.toContain("color-mix");
  });

  // The tool-group switches write to ONE file (Claude Code's MCP config, via `claude mcp
  // add/remove`), so their POSTs are queued one behind the other. That queue is only half the
  // guard: a checkbox left live while its write waits its turn can be flipped again, and since a
  // failed write puts its own checkbox back, the earlier rollback would land on top of the later
  // intent — flip on, flip off, end up on. So the flip disables the box immediately.
  it("disables a tool-group switch from the flip until its write settles", async () => {
    const write = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") return write.promise;
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/my-project");
    await flushPromises();

    const box = w.find('[data-testid="cell-mcp-toggle-render"]');
    expect(box.exists()).toBe(true);
    await box.setValue(true);
    // Disabled while the write is in flight — not merely once it reaches the front of the queue.
    expect(box.attributes("disabled")).toBeDefined();

    write.resolve({ ok: true, json: async () => ({ ok: true }) });
    await flushPromises();
    await nextTick();
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').attributes("disabled")).toBeUndefined();
  });

  // A rejected write is the case the lock exists for: the checkbox goes back to where it was,
  // and it must be the flip that was actually attempted.
  it("puts the tool-group switch back when its write fails", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/my-project");
    await flushPromises();
    const box = w.find('[data-testid="cell-mcp-toggle-render"]');
    await box.setValue(true);
    await flushPromises();
    await nextTick();

    expect((w.find('[data-testid="cell-mcp-toggle-render"]').element as HTMLInputElement).checked).toBe(false);
    expect(w.text()).toContain("failed");
  });

  // A queued write can run long after the flip, and the launcher's directory field is editable
  // the whole time. The write below waits behind another group's save; read at execution time,
  // the switch ticked for alpha would register the MCP server against beta — a silent write to a
  // folder the user never touched the switch in.
  it("writes a queued group registration to the directory it was flipped in", async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const posted: { cwd: string; group: string; enabled: boolean }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          // Only the FIRST write hangs; the second is what has to wait behind it.
          return posted.length === 1 ? first.promise : { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/alpha");
    await flushPromises();

    // media goes first and hangs; render queues behind it, both flipped in alpha.
    await w.find('[data-testid="cell-mcp-toggle-media"]').setValue(true);
    await w.find('[data-testid="cell-mcp-toggle-render"]').setValue(true);
    expect(posted).toHaveLength(1);

    // The user retypes the directory while render's write is still queued. The launcher reloads
    // the switches for the new directory behind a 300ms debounce, so let it fire — that reload is
    // what moves mcpGroupDir off alpha, and it is exactly what the queued write must not pick up.
    vi.useFakeTimers();
    try {
      await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/beta");
      await vi.advanceTimersByTimeAsync(400);

      first.resolve({ ok: true, json: async () => ({ ok: true }) });
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();

    expect(posted).toHaveLength(2);
    expect(posted.map((body) => body.cwd)).toEqual(["/home/me/alpha", "/home/me/alpha"]);
  });

  // The switch writes Claude Code's per-folder MCP config, but it is no longer only claude's:
  // a codex grid cell is handed the SAME groups as resolved `-c mcp_servers.*` urls at spawn
  // (server/session/spawn-codex.ts). Hiding the rows on codex left that path with no way to be
  // turned on from the cell that uses it.
  it("offers the tool-group switches for codex as well as claude", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) return { ok: true, json: async () => ({ groups: ["render"] }) };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/my-project");
    await flushPromises();
    const codexButton = w.findAll('[role="radio"]').find((b) => b.text() === "Codex");
    expect(codexButton).toBeDefined();
    await codexButton?.trigger("click");
    await nextTick();

    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-media"]').exists()).toBe(true);
    // And it reads the same registration claude's rows do.
    expect((w.find('[data-testid="cell-mcp-toggle-render"]').element as HTMLInputElement).checked).toBe(true);
  });

  // `data` and `external` were routed, gated and pre-approved on the server from the day the
  // groups were defined, but the launcher only ever drew the two Canvas rows — so the only way to
  // reach a collection or a google tool from a grid cell was to type `claude mcp add` by hand.
  // One row per group in TOOL_GROUPS, reading and writing the same registration the other two do.
  it("offers a switch for every tool group, not just the Canvas ones", async () => {
    const posted: { cwd: string; group: string; enabled: boolean }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ groups: ["data"] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/alpha");
    await flushPromises();

    for (const group of TOOL_GROUPS) expect(w.find(`[data-testid="cell-mcp-toggle-${group}"]`).exists()).toBe(true);
    // A group registered on disk comes back ticked, whichever group it is.
    expect((w.find('[data-testid="cell-mcp-toggle-data"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('[data-testid="cell-mcp-toggle-external"]').element as HTMLInputElement).checked).toBe(false);

    await w.find('[data-testid="cell-mcp-toggle-external"]').setValue(true);
    await flushPromises();
    expect(posted).toEqual([{ cwd: "/home/me/alpha", group: "external", enabled: true }]);
  });

  // A REUSED worktree can carry a registration from an earlier launch. Mirroring only the ticked
  // groups into it leaves that one standing, so the session gets tools the launcher shows as off
  // — `external` reaching a third-party account is the case that makes it matter. The groups that
  // already agree are left alone, because every write shells out to the `claude` CLI.
  it("clears a stale worktree registration for a group that is switched off", async () => {
    const posted: { cwd: string; group: string; enabled: boolean }[] = [];
    const groupsByCwd: Record<string, string[]> = {
      "/home/me/repo": ["render"],
      "/wt/old-task": ["render", "external"],
    };
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({ ok: true }) };
        }
        const cwd = decodeURIComponent(u.split("cwd=")[1] ?? "");
        return { ok: true, json: async () => ({ groups: groupsByCwd[cwd] ?? [] }) };
      }
      if (u.includes("/api/worktrees"))
        return {
          ok: true,
          json: async () => ({ isGit: true, base: "main", worktrees: [{ path: "/wt/old-task", branch: "agent/old-task", task: "old-task", dirty: false }] }),
        };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/repo");
    await flushPromises();
    await w.find('[data-testid="worktree-reuse"]').trigger("click");
    await flushPromises();

    // render agrees on both sides, data and media are off and absent — only the stale one moves.
    expect(posted).toEqual([{ cwd: "/wt/old-task", group: "external", enabled: false }]);
  });

  // The switches belong to a DIRECTORY, and the reload behind them is debounced. Left on screen
  // during that gap they are the previous directory's positions, and flipping one writes the MCP
  // registration there — a directory the user has already typed their way off.
  it("takes the switches away the moment the directory field changes", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) return { ok: true, json: async () => ({ groups: ["render"] }) };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/alpha", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/alpha");
    await flushPromises();
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);

    vi.useFakeTimers();
    try {
      await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/beta");
      // Before the 300ms reload: no rows at all rather than beta's name over alpha's positions.
      expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    await nextTick();
    expect((w.find('[data-testid="cell-mcp-toggle-render"]').element as HTMLInputElement).checked).toBe(true);
  });

  // Ticking a group and launching in the same breath is the ordinary way to use these: the switch
  // is what the session about to start needs. The launch takes the whole form off the screen, so
  // the write it queued has to be one the form is no longer party to — tie it to the component's
  // lifetime and the registration is silently dropped for the session it was ticked for.
  it("still writes a tool-group registration queued a moment before the launch", async () => {
    const posted: { cwd: string; group: string; enabled: boolean }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    const w = mountProjectCell("/home/me/proj");
    await flushPromises();
    await w.find('[data-testid="cell-mcp-toggle-render"]').setValue(true);
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    await flushPromises();

    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(false); // it really did launch
    expect(posted).toEqual([{ cwd: "/home/me/proj", group: "render", enabled: true }]);
  });
});

// A launch chip says two things at once — which directory it is, and whether a session is
// already running there. They used to be drawn in the same two places (background + border) at
// identical strengths, so once directories were colour-coded a tint stopped meaning "running",
// and a directory whose colour was blue read as running while idle (#1106).
describe("launch chips: directory colour vs. running", () => {
  const chipFor = (w: ReturnType<typeof mount>, label: string) =>
    w.findAll('[data-testid="cell-chip"]').find((c) => c.find('[data-testid="cell-chip-main"]').text() === label);

  // Unique paths per test: the dir-config cache is module-level and keyed by cwd.
  function mountChips(colouredPath: string, runningPath: string, colour = "#2f6eb1") {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/dir-config")) {
        const coloured = u.includes(encodeURIComponent(colouredPath));
        return { ok: true, json: async () => (coloured ? { headerColor: colour } : {}) };
      }
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/x", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;

    return mountCell(null, {
      defaultCwd: "/home/me/proj",
      presets: [
        { label: "coloured", path: colouredPath },
        { label: "running", path: runningPath },
      ],
      openCwds: [runningPath],
    });
  }

  // The bug itself: the directory's colour reached the chip's own background, which is what
  // "running" means. It has to stay on the stripe.
  it("gives an idle chip no background of its own, however it is coloured", async () => {
    const w = mountChips("/c1", "/r1");
    await flushPromises();
    const chip = chipFor(w, "coloured");
    if (!chip) throw new Error("coloured chip not found");

    expect(chip.attributes("style") ?? "").not.toContain("background");
    expect(chip.classes().join(" ")).not.toContain("color-mix");
    // The colour is still on screen — just confined to the stripe.
    expect(chip.find('[data-testid="cell-chip-color"]').attributes("style")).toContain("rgb(47, 110, 177)");
  });

  it("marks the running chip with a background and a pulsing dot", async () => {
    const w = mountChips("/c2", "/r2");
    await flushPromises();
    const chip = chipFor(w, "running");
    if (!chip) throw new Error("running chip not found");

    expect(chip.classes().join(" ")).toContain("color-mix");
    expect(chip.find('[data-testid="cell-chip-dot"]').classes()).toContain("animate-cell-pulse");
  });

  // The two assertions above can each pass while the states still render alike. This is the one
  // that says the user can tell them apart.
  it("never renders a coloured idle chip the same as a running one", async () => {
    const w = mountChips("/c3", "/r3");
    await flushPromises();
    const idle = chipFor(w, "coloured");
    const running = chipFor(w, "running");
    if (!idle || !running) throw new Error("chips not found");

    const signature = (c: NonNullable<ReturnType<typeof chipFor>>) => `${c.classes().sort().join(" ")}|${c.attributes("style") ?? ""}`;
    expect(signature(idle)).not.toBe(signature(running));
    // And only one of them claims the running state.
    expect(idle.find('[data-testid="cell-chip-dot"]').exists()).toBe(false);
    expect(running.find('[data-testid="cell-chip-dot"]').exists()).toBe(true);
  });

  // Everything above is colour, shape and motion — none of which reaches a screen reader, and
  // the dot is aria-hidden. The chip's own button has to SAY it (the ▶ beside it already did).
  it("says a session is running in the chip's accessible name, not only in colour", async () => {
    const w = mountChips("/c5", "/r5");
    await flushPromises();
    const idle = chipFor(w, "coloured");
    const running = chipFor(w, "running");
    if (!idle || !running) throw new Error("chips not found");

    expect(running.find('[data-testid="cell-chip-main"]').attributes("aria-label")).toContain("already running");
    expect(idle.find('[data-testid="cell-chip-main"]').attributes("aria-label")).not.toContain("already running");
  });

  // A directory colour-coded in the SAME blue the running state uses is the case that made the
  // old design unreadable: it looked running, always.
  it("keeps a blue-coded idle directory distinguishable from a running one", async () => {
    const w = mountChips("/c4", "/r4", "#3b82f6");
    await flushPromises();
    const idle = chipFor(w, "coloured");
    const running = chipFor(w, "running");
    if (!idle || !running) throw new Error("chips not found");

    // Class AND style: the old design put the wash in an inline style, so a check on classes
    // alone would have passed against exactly the bug this test is here for.
    const painted = (c: NonNullable<ReturnType<typeof chipFor>>) => `${c.classes().join(" ")} ${c.attributes("style") ?? ""}`;
    expect(painted(idle)).not.toContain("color-mix");
    expect(painted(running)).toContain("color-mix");
  });
});

// #1114: an empty cell can start a plain shell with nothing configured. Until this, the only
// shells reachable from the launch form were the user's own `launchers` entries — so a fresh
// install offered three agents and no terminal, and the reporter went looking through Settings.
describe("TerminalCell launch target — the OS default shell (#1114)", () => {
  const SHELL_PICK = { launcher: { shell: true, label: "shell" }, cwd: "/home/me/proj" };

  // A git repo whose MCP config reads back, so all three agent-only sections are on screen.
  function mockFetchWithAgentOptions() {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) return { ok: true, json: async () => ({ groups: [] }) };
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
    }) as unknown as typeof fetch;
  }

  const pick = (w: ReturnType<typeof mount>, agent: string) => w.find(`[data-testid="agent-picker-${agent}"]`).trigger("click");

  it("offers every built-in agent then Shell, with Claude picked", async () => {
    const w = mountCell(null);
    await flushPromises();
    const row = w.find('[role="radiogroup"]');
    expect(row.findAll('[role="radio"]').map((b) => b.text())).toEqual(["Claude", "Codex", "Antigravity", "Grok", "Shell"]);
    expect(w.find('[data-testid="agent-picker-claude"]').attributes("aria-checked")).toBe("true");
    expect(w.find('[data-testid="agent-picker-shell"]').attributes("aria-checked")).toBe("false");
  });

  it("starts the OS default shell in the typed dir — no configured launcher needed", async () => {
    const w = mountCell(null);
    await flushPromises();
    await pick(w, "shell");
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/proj");
    await w.find('[data-testid="cell-dir-go"]').trigger("click");
    // The launcher carries no index: nothing in the user's config is being pointed at.
    expect(w.emitted("launch")).toEqual([[SHELL_PICK]]);
    // NOT a session launch — the parent swaps this cell for a launcher cell, so the form stays
    // put and no agent is persisted for it.
    expect(w.emitted("agent")).toBeUndefined();
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  // The other launch button in the same form. The Agent Picker has to decide here too, or one pick
  // opens a shell from the dir field and an agent from the chip beside it.
  it("starts a shell from a directory chip's launch button too", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/home/me/proj" }] });
    await flushPromises();
    await pick(w, "shell");
    await chipForPath(w, "/home/me/proj").find('[data-testid="cell-chip-launch"]').trigger("click");
    expect(w.emitted("launch")).toEqual([[SHELL_PICK]]);
    expect(w.emitted("agent")).toBeUndefined();
  });

  it("still starts a Claude session while Claude stays picked", async () => {
    const w = mountCell(null);
    await flushPromises();
    await w.find('[data-testid="cell-dir-input"]').setValue("/home/me/proj");
    await w.find('[data-testid="cell-dir-go"]').trigger("click");
    expect(w.emitted("launch")).toBeUndefined();
    expect(w.emitted("agent")).toEqual([["claude"]]);
  });

  it("hides the model / MCP / worktree options for a shell and brings them back for an agent", async () => {
    mockFetchWithAgentOptions();
    const w = mountProjectCell("/home/me/my-project");
    await flushPromises();
    expect(w.find('[data-testid="cell-model-help"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);

    await pick(w, "shell");
    expect(w.find('[data-testid="cell-model-help"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(false);

    // Back to an agent: the sections return. Codex keeps its own model configuration, so the
    // model picker is Claude's alone — that part is unchanged by the shell option.
    await pick(w, "codex");
    expect(w.find('[data-testid="cell-mcp-toggle-render"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-worktrees"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-model-help"]').exists()).toBe(false);
    await pick(w, "claude");
    expect(w.find('[data-testid="cell-model-help"]').exists()).toBe(true);
  });
});
