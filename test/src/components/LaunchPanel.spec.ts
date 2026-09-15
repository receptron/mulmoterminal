// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LaunchPanel from "../../../src/components/LaunchPanel.vue";
import { customAgentPick } from "../../../common/customAgents";

// The panel mounts the real CellLaunchForm, which reads the directory's worktrees and sessions on
// open. Empty answers are the ordinary case and keep the assertions about the PANEL.
function mockFetch() {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, base: null, worktrees: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const mountPanel = (initialDir: string | null = "/home/me/proj") =>
  mount(LaunchPanel, {
    props: { initialDir, defaultCwd: "/home/me/workspace", presets: [], launchers: [], customAgents: [] },
    attachTo: document.body,
  });

beforeEach(mockFetch);

describe("LaunchPanel", () => {
  it("opens on the directory it was handed, not the workspace", async () => {
    const w = mountPanel("/home/me/proj");
    await flushPromises();
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/proj");
  });

  // Opening from the toolbar names no cell, so there is no directory to carry: the workspace is the
  // answer rather than an empty field the user has to fill before anything can start.
  it("falls back to the workspace when no directory was handed in", async () => {
    const w = mountPanel(null);
    await flushPromises();
    expect((w.find('[data-testid="cell-dir-input"]').element as HTMLInputElement).value).toBe("/home/me/workspace");
  });

  // The form's own `start` carries only the dir. In a cell the picker's state WAS the cell's, so
  // nothing had to say what was picked; a host outside the grid has to be told.
  it("reports the picked agent alongside the directory on start", async () => {
    const w = mountPanel();
    await flushPromises();
    w.findComponent({ name: "CellLaunchForm" }).vm.$emit("update:agent", customAgentPick("kimi_k3"));
    await flushPromises();
    w.findComponent({ name: "CellLaunchForm" }).vm.$emit("start", "/home/me/other");
    // The panel now AWAITS `/api/agents` before emitting, so that a machine without Claude Code
    // never has a Claude cell placed on it (#2082, Codex round 1). One microtask once settled.
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual([{ dir: "/home/me/other", pick: customAgentPick("kimi_k3"), choice: null }]);
  });

  // Dropping it is silent: the cell starts on the directory's default model and nothing says the
  // pick went. The in-cell form honoured it, so the panel losing it would be a regression.
  it("carries the model pick out with the start", async () => {
    const w = mountPanel();
    await flushPromises();
    const form = w.findComponent({ name: "CellLaunchForm" });
    form.vm.$emit("update:choice", { provider: "openrouter", model: "moonshotai/kimi-k3" });
    await flushPromises();
    form.vm.$emit("start", "/home/me/proj");
    // The panel now AWAITS `/api/agents` before emitting, so that a machine without Claude Code
    // never has a Claude cell placed on it (#2082, Codex round 1). One microtask once settled.
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual([{ dir: "/home/me/proj", pick: "claude", choice: { provider: "openrouter", model: "moonshotai/kimi-k3" } }]);
  });

  it("starts on Claude however the panel was opened", async () => {
    const w = mountPanel();
    await flushPromises();
    w.findComponent({ name: "CellLaunchForm" }).vm.$emit("start", "/home/me/proj");
    // The panel now AWAITS `/api/agents` before emitting, so that a machine without Claude Code
    // never has a Claude cell placed on it (#2082, Codex round 1). One microtask once settled.
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual([{ dir: "/home/me/proj", pick: "claude", choice: null }]);
  });

  // The close button lives in the form and is shown only for a `cancellable` one. The panel is
  // always cancellable — unlike the grid's entry cell, it is something the user opened.
  it("is closable, and the close reaches the host", async () => {
    const w = mountPanel();
    await flushPromises();
    const close = w.find('[data-testid="cell-launch-cancel"]');
    expect(close.exists()).toBe(true);
    await close.trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  // The panel covers only the right of the stage, so focus moves out of it the moment anyone clicks
  // the grid or the toolbar — and an Escape bound to the <aside> would then never fire. This is the
  // close path that was claimed before it was true (CodeRabbit, #1890).
  it("closes on Escape even when focus is outside the panel", async () => {
    const w = mountPanel();
    await flushPromises();
    document.body.focus();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
  });

  // xterm's input surface is a real textarea and Escape is meaningful inside it. Closing the panel
  // from there would steal the key from the program the user is looking at.
  it("leaves Escape alone inside a terminal", async () => {
    const w = mountPanel();
    await flushPromises();
    const term = document.createElement("textarea");
    term.className = "xterm-helper-textarea";
    document.body.appendChild(term);
    term.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
    term.remove();
  });

  // A keyboard user who opens the panel from a terminal's `+` and closes it should be back on that
  // `+`, not dropped on the document (codex [P2], #1890).
  it("returns focus to whatever opened it when it closes", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const w = mountPanel();
    await flushPromises();
    expect(document.activeElement).not.toBe(opener); // the dir field took it
    w.unmount();
    await flushPromises();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // A launch moves focus on purpose, and a click elsewhere means the user has already chosen where
  // they are. Yanking them back to the opener would be the same rudeness in the other direction.
  it("leaves focus alone when it has already moved outside the panel", async () => {
    const opener = document.createElement("button");
    const elsewhere = document.createElement("input");
    document.body.append(opener, elsewhere);
    opener.focus();
    const w = mountPanel();
    await flushPromises();
    elsewhere.focus();
    w.unmount();
    await flushPromises();
    expect(document.activeElement).toBe(elsewhere);
    opener.remove();
    elsewhere.remove();
  });

  it("focuses the directory field so Enter alone can start", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(document.activeElement).toBe(w.find('[data-testid="cell-dir-input"]').element);
  });
});
