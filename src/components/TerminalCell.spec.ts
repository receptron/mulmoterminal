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
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    emits: ["session", "cwd"],
    // Render the header-actions slot so the cell's icon buttons (moved onto the
    // terminal's header row) are present in the test DOM — but only when the header
    // is shown, mirroring Terminal.vue's `v-if="!hideHeader"`.
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: {
      terminate() {},
      submitText() {
        return true;
      },
    },
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
  } = {},
) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: opts.expanded ?? false,
      zoomed: opts.zoomed ?? false,
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
    await w.find(".cell-dir-input").trigger("keydown.enter");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("launches via the go button next to the field (alternative to Enter)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-dir-go").trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/home/me/picked");
  });

  it("disables the go button when the field is empty", async () => {
    const w = mountCell(null, { defaultCwd: null });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("   ");
    expect((w.find(".cell-dir-go").element as HTMLButtonElement).disabled).toBe(true);
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    expect((w.find(".cell-dir-go").element as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a cancel ✕ on a cancellable launcher that emits close, but not otherwise", async () => {
    const plain = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    expect(plain.find(".cell-launch-cancel").exists()).toBe(false);

    const w = mountCell(null, { defaultCwd: "/home/me/default", cancellable: true });
    await flushPromises();
    await w.find(".cell-launch-cancel").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
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

  it("flags a resumable row that's already open in another terminal", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([
      { id: openId, title: "running over there", mtime: Date.now() },
      { id: "99999999-9999-9999-9999-999999999999", title: "idle elsewhere", mtime: Date.now() },
    ]);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    const items = w.findAll(".cell-resume-item");
    expect(items[0].classes()).toContain("is-open");
    expect(items[0].find(".ri-open").exists()).toBe(true);
    expect(items[1].classes()).not.toContain("is-open");
    expect(items[1].find(".ri-open").exists()).toBe(false);
  });

  it("confirms before resuming a session open elsewhere, and bails on cancel", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([{ id: openId, title: "running over there", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    confirmSpy.mockRestore();
  });

  it("resumes a session open elsewhere once the confirm is accepted", async () => {
    const openId = "88888888-8888-8888-8888-888888888888";
    mockFetch([{ id: openId, title: "running over there", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: [openId] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(w.findComponent({ name: "TerminalView" }).props("sessionId")).toBe(openId);
    confirmSpy.mockRestore();
  });

  it("resumes a not-open-elsewhere session without any confirm", async () => {
    const id = "77777777-7777-7777-7777-777777777777";
    mockFetch([{ id, title: "fix the parser", mtime: Date.now() }]);
    const confirmSpy = vi.spyOn(window, "confirm");
    const w = mountCell(null, { defaultCwd: "/home/me/proj", openSessionIds: ["other-id"] });
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click");
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
    const chipB = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "B");
    if (!chipB) throw new Error("preset B not found");
    await chipB.find(".cell-chip-fill").trigger("click"); // fillDir → fetch #2 (dir B)

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

  it("clicking a preset chip launches a fresh session in its dir", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const main = w.findAll(".cell-chip-main").find((b) => b.text() === "proj");
    if (!main) throw new Error("preset chip not found");
    await main.trigger("click");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.exists()).toBe(true);
    expect(term.props("cwd")).toBe("/work/proj");
  });

  it("a chip's fill button sets the dir WITHOUT launching (so the user can resume)", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find(".cell-chip-fill").trigger("click");
    // No terminal — the fill button only selects the directory.
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/work/proj");
  });

  it("emits record-cwd with the server-confirmed cwd of a fresh launch", async () => {
    // A fresh launch + the server confirming the effective cwd asks the parent to
    // auto-record that dir as a preset (the parent persists it to config).
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/alpha");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/alpha");
    await flushPromises();
    expect(w.emitted("record-cwd")?.at(-1)).toEqual(["/home/me/alpha"]);
  });

  it("emits remove-preset (and does NOT launch) when a chip's ✕ is clicked", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const chip = w.findAll(".cell-chip").find((c) => c.find(".cell-chip-main").text() === "proj");
    if (!chip) throw new Error("preset chip not found");
    await chip.find(".cell-chip-del").trigger("click");
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
    await w.find(".cell-resume-item").trigger("click");
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
    await w.find(".cell-dir-input").setValue("/home/me/fresh");
    await w.find(".cell-dir-input").trigger("keydown.enter"); // flag = true, no cwd yet
    await w.find(".cell-close").trigger("click"); // teardown must clear the flag
    await flushPromises();
    await w.find(".cell-resume-item").trigger("click"); // resume an existing session
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/proj");
    await flushPromises();
    expect(w.emitted("record-cwd")).toBeUndefined();
  });

  it("prefills the launch field with the most recent preset (not the server default)", async () => {
    const w = mountCell(null, { presets: [{ label: "last", path: "/home/me/last-used" }], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/last-used");
  });

  it("syncs a late-arriving preset into the pristine launch field (open-before-config-load)", async () => {
    // Cold load: the cell mounts before /api/config resolves, so presets start empty
    // and the field falls back to the server default.
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/default");
    // /api/config resolves, delivering the most-recent preset — the pristine field upgrades.
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/alpha");
  });

  it("does NOT override a user-edited launch field when presets arrive late", async () => {
    const w = mountCell(null, { presets: [], defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/typed");
    await w.setProps({ presets: [{ label: "alpha", path: "/home/me/alpha" }] });
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/typed");
  });

  it("resets the launch form to the default dir after close", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("/home/me/picked");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find(".cell-launch").exists()).toBe(true);
    expect((w.find(".cell-dir-input").element as HTMLInputElement).value).toBe("/home/me/default");
  });

  it("adopts the EFFECTIVE cwd the server reports (persists/shows that, not the typed one)", async () => {
    const w = mountCell(null, { defaultCwd: "/home/me/default" });
    await flushPromises();
    await w.find(".cell-dir-input").setValue("relative/bad/path");
    await w.find(".cell-dir-input").trigger("keydown.enter");
    // Server rejected the bad path and fell back; it reports the real cwd.
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/default");
    await nextTick();
    // The cell persists + displays the effective cwd, not the typed one.
    expect(w.emitted("cwd")?.at(-1)).toEqual(["/home/me/default"]);
    expect(w.find(".cell-dir").text()).toBe("~/default");
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

  it("shows a token-usage badge from /api/session/:id", async () => {
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
    const w = mountCell(id);
    await flushPromises();
    const badge = w.find(".cell-usage");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("2.0k"); // input 1200 + cacheRead 800 = 2000
    expect(badge.text()).toContain("3.4k"); // output 3400
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
    const badge = w.find(".cell-model");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("Opus · ctx 35%"); // 70k / 200k
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
    expect(w.find(".cell-model").exists()).toBe(false);
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
    await w.find(".cell-wt-badge").trigger("click");
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(true);
    // leaving the worktree clears `diff`; the panel must not linger as an empty overlay
    w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", "/home/me/plain-proj");
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(false);
  });

  it("does not auto-reopen the diff panel after leaving and re-entering a worktree", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 2, dirty: 0, files: [], patch: "x", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-wt-badge").trigger("click"); // user opens the panel
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(true);

    const term = w.findComponent({ name: "TerminalView" });
    term.vm.$emit("cwd", "/home/me/plain-proj"); // leave the worktree → panel closes
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(false);

    term.vm.$emit("cwd", WT_CWD); // re-enter a worktree
    await flushPromises();
    expect(w.find(".cell-wt-badge").exists()).toBe(true); // badge returns…
    expect(w.find(".cell-diff").exists()).toBe(false); // …but the panel stays closed until clicked
  });

  it("closes the diff panel on Escape (document-level handler)", async () => {
    mockFetchWithDiff({ isWorktree: true, base: "main", ahead: 1, dirty: 0, files: [], patch: "x", truncated: false });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-wt-badge").trigger("click");
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // focus may be on the badge/terminal
    await flushPromises();
    expect(w.find(".cell-diff").exists()).toBe(false);
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
    expect(w.find(".cell-wt-badge").exists()).toBe(false);
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
    await w.find(".cell-wt-badge").trigger("click");
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
    const btns = w.findAll(".cell-diff-btn");
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
    const push = w.findAll(".cell-diff-btn").find((b) => b.text().includes("Push"));
    if (!push) throw new Error("Push button not found");
    await push.trigger("click");
    await flushPromises();
    const req = posts.find((p) => p.url.includes("/api/worktrees/push"));
    if (!req) throw new Error("push not called");
    expect(JSON.parse(req.body)).toEqual({ cwd: WT_CWD });
    expect(w.find(".cell-diff-msg").text()).toBe("Pushed agent/fix-login");
  });

  it("Open PR opens the returned url in a new tab", async () => {
    mockFetchWithPr(aheadDiff(2), { body: { ok: true, url: "https://github.com/owner/repo/pull/9", via: "gh" } });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const pr = w.findAll(".cell-diff-btn").find((b) => b.text().includes("Open PR"));
    if (!pr) throw new Error("Open PR button not found");
    await pr.trigger("click");
    await flushPromises();
    expect(openSpy).toHaveBeenCalledWith("https://github.com/owner/repo/pull/9", "_blank", "noopener,noreferrer");
    expect(w.find(".cell-diff-msg").text()).toBe("PR created");
    openSpy.mockRestore();
  });

  it("shows a friendly message when push fails with no remote (409)", async () => {
    mockFetchWithPr(aheadDiff(2), { status: 409, body: { ok: false, reason: "no-remote" } });
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await openPanel(w);
    const push = w.findAll(".cell-diff-btn").find((b) => b.text().includes("Push"));
    await push?.trigger("click");
    await flushPromises();
    expect(w.find(".cell-diff-msg").text()).toContain("No git remote");
  });

  const commitBtn = (w: ReturnType<typeof mountCell>) => w.findAll(".cell-diff-btn").find((b) => b.text().includes("Commit"));

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
    expect(w.find(".cell-diff-msg").text()).toContain("Asked Claude to commit");
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
    expect(w.find(".cell-diff-msg").text()).toContain("Couldn't reach the session");
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
    const push = w.findAll(".cell-diff-btn").find((b) => b.text().includes("Push"));
    await push?.trigger("click");
    await flushPromises();
    const msg = w.find(".cell-diff-msg").text();
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
    expect(w.find(".cell-close-confirm").exists()).toBe(true);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(true); // session not torn down yet
  });

  it("a NON-worktree cell still closes immediately (no confirm)", async () => {
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: "/home/me/plain-proj" });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await nextTick();
    expect(w.find(".cell-close-confirm").exists()).toBe(false);
    expect(w.find(".cell-launch").exists()).toBe(true); // torn down to the launcher
  });

  it("Keep worktree tears the cell down WITHOUT removing the room", async () => {
    const posts = mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await w.find(".ccx-keep").trigger("click");
    await flushPromises();
    expect(posts.some((p) => p.url.includes("/api/worktrees/remove"))).toBe(false);
    expect(w.find(".cell-launch").exists()).toBe(true);
  });

  it("Remove worktree posts a forced remove (path+repoDir = the worktree) then closes", async () => {
    const posts = mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await flushPromises(); // the close() diff refresh enables the Remove button
    await w.find(".ccx-remove").trigger("click");
    await flushPromises();
    const rm = posts.find((p) => p.url.includes("/api/worktrees/remove"));
    if (!rm) throw new Error("remove not called");
    expect(JSON.parse(rm.body)).toMatchObject({ repoDir: WT_CWD, path: WT_CWD, deleteBranch: true, force: true });
    expect(w.find(".cell-launch").exists()).toBe(true);
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
    expect(w.find(".ccx-remove").attributes("disabled")).toBeDefined(); // held while checking
    gate.resolve({ ok: true, json: async () => cleanWtDiff });
    await flushPromises();
    expect(w.find(".ccx-remove").attributes("disabled")).toBeUndefined(); // released
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
    await w.find(".ccx-remove").trigger("click");
    await flushPromises();
    expect(w.find(".cell-close-confirm").exists()).toBe(true); // NOT torn down
    expect(w.find(".cell-launch").exists()).toBe(false);
    expect(w.find(".ccx-warn").text()).toContain("Couldn't remove");
  });

  it("Escape dismisses the close confirmation", async () => {
    mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    expect(w.find(".cell-close-confirm").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(w.find(".cell-close-confirm").exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(true);
  });

  it("Cancel keeps the session running", async () => {
    mockFetchCloseCleanup(cleanWtDiff);
    const w = mountCell("66666666-6666-6666-6666-666666666666", { initialCwd: WT_CWD });
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await w.find(".ccx-cancel").trigger("click");
    expect(w.find(".cell-close-confirm").exists()).toBe(false);
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
    const warn = w.find(".ccx-warn");
    expect(warn.exists()).toBe(true);
    expect(warn.text()).toContain("2 unpushed");
    expect(warn.text()).toContain("1 uncommitted");
    expect(w.find(".ccx-remove").text()).toContain("Discard");
  });

  it("keeps expand + close on row 1 (cell-header); the other icons live on row 2", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    // Row 1 (cell-header): dir + prompt + expand/close.
    const header = w.find(".cell-header");
    expect(header.find("button.cell-dir").exists()).toBe(true);
    expect(header.find(".cell-close").exists()).toBe(true);
    expect(header.find('[aria-label="Expand terminal"]').exists()).toBe(true);
    // The timeline / reorder / GitHub icons stay on row 2 (the TerminalView slot).
    expect(header.find('[aria-label="Show activity timeline"]').exists()).toBe(false);
    expect(w.find('[aria-label="Show activity timeline"]').exists()).toBe(true);
  });

  it("shows the restore label + icon when the cell is expanded", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", expanded: true });
    await flushPromises();
    expect(w.find('[aria-label="Restore terminal"]').exists()).toBe(true);
    expect(w.find("button.cell-dir").exists()).toBe(true); // dir stays clickable
  });

  it("a filmstrip thumbnail (another cell zoomed) drops to dir + activity + zoom only", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    // Info stripped: no git chip / usage; the second (terminal) header row is hidden.
    expect(w.find(".git-chip").exists()).toBe(false);
    expect(w.find(".cell-usage").exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).props("hideHeader")).toBe(true);
    // Row 1 keeps dir + prompt + the expand/close actions (row 2 is hidden).
    expect(w.find('[aria-label="Expand terminal"]').exists()).toBe(true);
    // The dir stays visible but as inert text (not an "open dir" button).
    expect(w.find("span.cell-dir").exists()).toBe(true);
    expect(w.find("button.cell-dir").exists()).toBe(false);
  });

  it("a filmstrip thumbnail's dir click zooms (switch to it) instead of opening the dir", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn((url: string) => {
      urls.push(String(url));
      if (String(url).includes("/api/sessions")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) });
    }) as unknown as typeof fetch;

    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    await w.find(".cell-dir").trigger("click");

    expect(w.emitted("toggle-expand")).toHaveLength(1); // zoomed instead
    expect(urls).not.toContain("/api/open-dir"); // dir was NOT opened
  });

  it("does not zoom on a header-background click in the normal grid (only the ⤢ button zooms)", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj" });
    await flushPromises();
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
    // The dedicated button still works.
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail (switch to it)", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111", { initialCwd: "/home/me/proj", zoomed: true, expanded: false });
    await flushPromises();
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("tints a preset chip whose dir already has a running session elsewhere", () => {
    const w = mountCell(null, {
      presets: [
        { label: "proj-a", path: "/home/me/a" },
        { label: "proj-b", path: "/home/me/b" },
      ],
      openCwds: ["/home/me/a"],
    });
    const chips = w.findAll(".cell-chip");
    const running = chips.find((c) => c.text().includes("proj-a"));
    const idle = chips.find((c) => c.text().includes("proj-b"));
    expect(running?.classes()).toContain("is-running");
    expect(running?.find(".cell-chip-dot").exists()).toBe(true);
    // a11y: the running state is exposed in text, not just color/hover
    expect(running?.find(".cell-chip-main").attributes("aria-label")).toContain("already running");
    expect(idle?.classes()).not.toContain("is-running");
    expect(idle?.find(".cell-chip-dot").exists()).toBe(false);
    expect(idle?.find(".cell-chip-main").attributes("aria-label")).toBeUndefined();
  });
});
