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
    emits: ["session"],
    template: '<div class="stub-term" />',
    methods: { terminate() {} },
  },
}));

const promptText = (w: ReturnType<typeof mount>) => w.find(".cell-prompt").text();
const dotClass = (w: ReturnType<typeof mount>) => w.find(".cell-dot").classes();

beforeEach(() => {
  captured = null;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) })) as unknown as typeof fetch;
});

function mountCell(
  initialSessionId: string | null,
  opts: { initialCwd?: string | null; defaultCwd?: string | null; presets?: { label: string; path: string }[] } = {},
) {
  return mount(TerminalCell, {
    props: {
      expanded: false,
      initialSessionId,
      initialCwd: opts.initialCwd ?? null,
      defaultCwd: opts.defaultCwd ?? "/home/me/my-project",
      presets: opts.presets ?? [],
    },
  });
}

describe("TerminalCell", () => {
  it("shows the workspace dir basename in the header", async () => {
    const w = mountCell("11111111-1111-1111-1111-111111111111");
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("my-project");
  });

  it("derives the basename from a Windows-style path too", async () => {
    const w = mountCell("55555555-5555-5555-5555-555555555555", { initialCwd: "C:\\work\\proj" });
    await flushPromises();
    expect(w.find(".cell-dir").text()).toBe("proj");
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

  it("launches in a preset dir on one click", async () => {
    const w = mountCell(null, { presets: [{ label: "proj", path: "/work/proj" }] });
    await flushPromises();
    const btn = w.findAll(".cell-preset").find((b) => b.text() === "proj");
    if (!btn) throw new Error("preset button not found");
    await btn.trigger("click");
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
    expect(w.find(".cell-dir").text()).toBe("default");
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
});
