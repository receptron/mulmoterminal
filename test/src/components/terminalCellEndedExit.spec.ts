import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { STARTUP_WINDOW_MS } from "../../../common/endedCellClose";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// The stub stands in for the terminal's `exit` event, which is the whole input to the auto-close
// (#3049): the cell must react through its template binding, not through a helper a test calls.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader", "launch", "customAgent", "agent"],
    emits: ["session", "cwd", "exit"],
    template: '<div class="stub-term"><slot name="header-actions" /></div>',
    methods: { terminate() {}, showHint() {}, toggleVoice: () => true },
  },
}));

const TERMINATE_RE = /\/api\/session\/[^/?]+\/terminate$/;
let terminateCalls: string[] = [];

beforeEach(() => {
  terminateCalls = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (TERMINATE_RE.test(u)) {
      terminateCalls.push(u);
      return { ok: true, status: 200, json: async () => ({ ok: true, ended: true }) };
    }
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const WORKTREE_CWD = "/home/me/proj/.claude/worktrees/proj-0123abcd/fix-thing";

const mountCell = (cwd = "/home/me/proj") =>
  mount(TerminalCell, {
    props: {
      uid: 7,
      expanded: false,
      collectionsAvailable: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: "sess-1",
      initialCwd: cwd,
      defaultCwd: "/home/me/proj",
      presets: [],
      home: "/home/me",
      openSessionIds: [],
      openCwds: [],
    },
  });

async function exitWith(w: ReturnType<typeof mountCell>, session: { sessionEnded: boolean; lifetimeMs: number | null; reattached: boolean }, exitCode = 0) {
  await flushPromises();
  w.findComponent({ name: "TerminalView" }).vm.$emit("exit", exitCode, session);
  await flushPromises();
}

describe("an agent cell whose session ended on its own", () => {
  it("closes through its normal teardown once the session ended after startup", async () => {
    const w = mountCell();
    await exitWith(w, { sessionEnded: true, lifetimeMs: STARTUP_WINDOW_MS, reattached: false });
    expect(w.emitted("close")).toHaveLength(1);
    expect(terminateCalls).toEqual(["/api/session/sess-1/terminate"]);
    w.unmount();
  });

  // Reopened onto an agent already running: an `/exit` right after is an ending, not a launch failure.
  it("closes a reattached cell whose agent ended soon after the attach", async () => {
    const w = mountCell();
    await exitWith(w, { sessionEnded: true, lifetimeMs: 100, reattached: true });
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });

  it.each([
    { name: "only the pty ended (a lost tmux client)", session: { sessionEnded: false, lifetimeMs: 60_000, reattached: false } },
    { name: "the agent died while starting", session: { sessionEnded: true, lifetimeMs: STARTUP_WINDOW_MS - 1, reattached: false } },
    { name: "the frame named no lifetime", session: { sessionEnded: true, lifetimeMs: null, reattached: false } },
  ])("stays open when $name", async ({ session }) => {
    const w = mountCell();
    await exitWith(w, session);
    expect(w.emitted("close")).toBeUndefined();
    expect(terminateCalls).toEqual([]);
    w.unmount();
  });

  // #3272: the code is the program's where tmux recorded it, and a crash keeps its banner on screen.
  it.each([137, 139, 1])("stays open when the agent exited %i", async (exitCode) => {
    const w = mountCell();
    await exitWith(w, { sessionEnded: true, lifetimeMs: 60_000, reattached: false }, exitCode);
    expect(w.emitted("close")).toBeUndefined();
    expect(terminateCalls).toEqual([]);
    w.unmount();
  });

  it("stays open in a worktree cell, whose close asks about the worktree", async () => {
    const w = mountCell(WORKTREE_CWD);
    await exitWith(w, { sessionEnded: true, lifetimeMs: 60_000, reattached: false });
    expect(w.emitted("close")).toBeUndefined();
    w.unmount();
  });
});
