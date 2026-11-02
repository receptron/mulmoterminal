import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { requestCellAction } from "../../../src/composables/useCellAction";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const hints: string[] = [];

// The stub records `connectKey`, which is the whole client half of a restart: bumping it is what
// retargets the slot at the same session id, and the server — with nothing live left to attach —
// spawns a new process that resumes the conversation. `header-actions` is rendered so the cell's
// own close button is in the DOM, which is how a test can close a cell mid-restart.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader", "launch", "customAgent", "agent"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term"><slot name="header-actions" /></div>',
    methods: {
      terminate() {},
      showHint(message: string) {
        hints.push(message);
      },
      toggleVoice() {
        voiceToggles.count++;
        return true;
      },
    },
  },
}));

const voiceToggles = vi.hoisted(() => ({ count: 0 }));
const copyCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../src/components/CopyCodeBlock.vue", () => ({
  default: {
    name: "CopyCodeBlock",
    props: ["sessionId", "cwd", "agent"],
    template: "<button />",
    methods: {
      async copyLastBlock() {
        copyCalls.count++;
      },
    },
  },
}));

const TERMINATE_RE = /\/api\/session\/[^/?]+\/terminate$/;

let terminate: { resolve: (ended?: boolean) => void; calls: string[] };

beforeEach(() => {
  hints.length = 0;
  const calls: string[] = [];
  let release: (ended: boolean) => void = () => {};
  const pending = new Promise<boolean>((r) => (release = r));
  terminate = { resolve: (ended = true) => release(ended), calls };
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (TERMINATE_RE.test(u)) {
      calls.push(`${init?.method} ${u}`);
      // `ended` is the route's post-condition — it answers 200 either way — so a test drives THAT
      // rather than the status code.
      const ended = await pending; // held open, so a test can look at the world mid-restart
      return { ok: true, status: 200, json: async () => ({ ok: true, ended }) };
    }
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/home/me/proj", scripts: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const mountCell = (initialSessionId: string | null) =>
  mount(TerminalCell, {
    props: {
      uid: 7,
      expanded: false,
      collectionsAvailable: false,
      zoomed: false,
      reorderable: false,
      initialSessionId,
      initialCwd: "/home/me/proj",
      defaultCwd: "/home/me/proj",
      presets: [],
      home: "/home/me",
      openSessionIds: [],
      openCwds: [],
    },
  });

const term = (w: ReturnType<typeof mountCell>) => w.findComponent({ name: "TerminalView" });

describe("restarting the agent in a cell", () => {
  // The name other Claude Code sessions message the cell by belongs to the PROCESS (#3237), and a
  // restart replaces the process. The old name goes the moment the cell reconnects, and the cell asks
  // again for the replacement's, with a fresh cell's tries.
  it("forgets the old process's name on restart and asks for the replacement's", async () => {
    const base = globalThis.fetch;
    let detailCalls = 0;
    let releaseSecond: () => void = () => {};
    const secondHeld = new Promise<void>((r) => (releaseSecond = r));
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/api\/session\/sess-1\?/.test(u)) {
        detailCalls++;
        if (detailCalls === 2) await secondHeld;
        return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null, peerName: detailCalls === 1 ? "old-7f" : "new-7f" }) };
      }
      return base(url, init);
    }) as unknown as typeof fetch;

    const w = mountCell("sess-1");
    await flushPromises();
    expect(w.get('[data-testid="cell-peer-chip"]').attributes("data-tip")).toContain("old-7f");

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();
    terminate.resolve();
    await flushPromises();
    expect(w.find('[data-testid="cell-peer-chip"]').exists()).toBe(false); // gone with the process
    expect(detailCalls).toBe(2); // and asked again at once

    releaseSecond();
    await flushPromises();
    expect(w.get('[data-testid="cell-peer-chip"]').attributes("data-tip")).toContain("new-7f");
  });

  it("reaps the session and only THEN reconnects the same id — the tmux race (#1918)", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    const before = Number(term(w).props("connectKey"));

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();

    // Mid-restart: the reap is in flight. Reconnecting here would hand `tmux new-session -A` a
    // session that is still alive, which ATTACHES the old process — a restart that changes nothing.
    expect(terminate.calls).toEqual(["POST /api/session/sess-1/terminate"]);
    expect(term(w).props("connectKey")).toBe(before);

    terminate.resolve();
    await flushPromises();
    expect(Number(term(w).props("connectKey"))).toBe(before + 1);
    // Same conversation, same cell: only the process was replaced.
    expect(term(w).props("sessionId")).toBe("sess-1");
    expect(hints).toEqual([]);
    w.unmount();
  });

  // The reap is a round trip and the cell can move on inside it. Reconnecting then retargets the
  // slot at whatever the cell holds NOW — and a just-launched session whose id the server has not
  // sent yet would be reconnected with no id at all, spawning a SECOND session (codex on #1920).
  it("does not reconnect a session the cell has moved on from", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    const before = Number(term(w).props("connectKey"));

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();
    term(w).vm.$emit("session", "sess-2"); // the cell is now on another session
    await flushPromises();
    const afterSwitch = Number(term(w).props("connectKey"));

    terminate.resolve();
    await flushPromises();
    expect(Number(term(w).props("connectKey"))).toBe(afterSwitch);
    expect(afterSwitch).toBe(before);
    w.unmount();
  });

  // The case codex named: closed and REUSED. The relaunched session has no id yet, so a stray
  // reconnect would go out with `sessionId: null` and start a second one, orphaning this.
  it("does not reconnect a cell that was closed and relaunched while the reap was in flight", async () => {
    const w = mountCell("sess-1");
    await flushPromises();

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();
    await w.find(".cell-close").trigger("click"); // back to the launch form
    await flushPromises();
    expect(term(w).exists()).toBe(false);

    await w.find('[data-testid="cell-chip-launch"]').trigger("click"); // start something else here
    await flushPromises();
    expect(term(w).props("sessionId")).toBeNull(); // brand new — the server has not named it yet
    const relaunched = Number(term(w).props("connectKey"));

    terminate.resolve();
    await flushPromises();
    expect(Number(term(w).props("connectKey"))).toBe(relaunched);
    w.unmount();
  });

  // A refused terminate leaves the old process in tmux. Reconnecting would attach it and redraw —
  // indistinguishable from a restart that worked, which is why the cell says so instead.
  it("says so, and reconnects nothing, when the session could not be ended", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    const before = Number(term(w).props("connectKey"));

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();
    terminate.resolve(false);
    await flushPromises();

    expect(Number(term(w).props("connectKey"))).toBe(before);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("restarted");
    w.unmount();
  });

  // Same window, the other half: a failed restart must not put its banner on the terminal that
  // replaced the one it was about — that agent was never restarted and has nothing to be told.
  it("says nothing to the terminal that replaced the one it was restarting", async () => {
    const w = mountCell("sess-1");
    await flushPromises();

    expect(requestCellAction("cell-7", "terminal-restart")).toBe(true);
    await flushPromises();
    await w.find(".cell-close").trigger("click");
    await flushPromises();
    await w.find('[data-testid="cell-chip-launch"]').trigger("click");
    await flushPromises();

    terminate.resolve(false);
    await flushPromises();
    expect(hints).toEqual([]);
    w.unmount();
  });

  // The Tools menu's entry is a third way in, and it works from a tile: a restart needs no room
  // beside the cell. It runs the same restart the other two reach.
  it("restarts from the Tools menu, on a tile", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    await w.find('[data-testid="cell-tools-btn"]').trigger("click");
    document.body.querySelector<HTMLButtonElement>('[data-testid="cell-pane-menu-restart"]')?.click();
    await flushPromises();
    expect(terminate.calls).toEqual(["POST /api/session/sess-1/terminate"]);
    terminate.resolve();
    await flushPromises();
    w.unmount();
  });

  it("offers no Tools menu on a tile before a session exists", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(w.find('[data-testid="cell-tools-btn"]').exists()).toBe(false);
    w.unmount();
  });

  it("declines for a cell that has no session, so the caller can say so", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-restart")).toBe(false);
    expect(terminate.calls).toEqual([]);
    w.unmount();
  });

  it("is not reachable once the cell is gone", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    w.unmount();
    expect(requestCellAction("cell-7", "terminal-restart")).toBe(false);
  });
});

// What the cell does by itself besides restarting (#2635). Panes and the launch panel are the
// grid's (TerminalGrid.runCellAction) and never reach the cell.
describe("the other actions a cell answers itself", () => {
  it("sets itself aside, or wakes", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-park")).toBe(true);
    expect(w.emitted("park")).toEqual([[true]]);
    w.unmount();
  });

  it("opens the timeline for a Claude session and declines without one", async () => {
    const empty = mountCell(null);
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-timeline")).toBe(false);
    empty.unmount();

    const w = mountCell("sess-1");
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-timeline")).toBe(true);
    w.unmount();
  });

  it("declines talk when there is no other terminal to talk to", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-talk")).toBe(false);
    w.unmount();
  });
});

// #2603: the launch panel on this cell's directory, by default, on row 2 beside the copy button.
describe("the row-2 new-here button", () => {
  it("asks the grid for the launch panel on this cell", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    await w.find('[data-testid="cell-new-here-btn"]').trigger("click");
    expect(w.emitted("new-here")).toEqual([[]]);
    w.unmount();
  });
});

// #2653: the row-2 and path-menu operations by name.
describe("the row-2 and path-menu actions a cell answers itself", () => {
  it("copies the last code block and toggles the mic through the same components as their buttons", async () => {
    copyCalls.count = 0;
    voiceToggles.count = 0;
    const w = mountCell("sess-1");
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-copy-code")).toBe(true);
    expect(requestCellAction("cell-7", "terminal-voice")).toBe(true);
    expect(copyCalls.count).toBe(1);
    expect(voiceToggles.count).toBe(1);
    w.unmount();
  });

  it("declines copy and the note without a session, and the diff panel without changes", async () => {
    const w = mountCell(null);
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-copy-code")).toBe(false);
    expect(requestCellAction("cell-7", "terminal-note")).toBe(false);
    expect(requestCellAction("cell-7", "terminal-diff")).toBe(false);
    // On the launch form there is no terminal to act on: every self action but set-aside declines,
    // before it opens a picker or a folder.
    (
      [
        "terminal-restart",
        "terminal-timeline",
        "terminal-talk",
        "terminal-copy-code",
        "terminal-insert-path",
        "terminal-reveal",
        "terminal-voice",
        "terminal-diff",
        "terminal-note",
      ] as const
    ).forEach((action) => expect(requestCellAction("cell-7", action), action).toBe(false));
    await flushPromises();
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => /\/api\/(pick|open-dir)/.test(String(url)))).toBe(false);
    expect(requestCellAction("cell-7", "terminal-park")).toBe(true);
    w.unmount();
  });

  it("inserts a picked path through the file-dialog route", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    expect(requestCellAction("cell-7", "terminal-insert-path")).toBe(true);
    await flushPromises();
    const calls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.includes("/api/pick"))).toBe(true);
    w.unmount();
  });

  it("opens the note editor, and reveals the directory through the open-dir route", async () => {
    const w = mountCell("sess-1");
    await flushPromises();
    expect(w.find('[data-testid="cell-memo-edit"]').exists()).toBe(true);
    expect(requestCellAction("cell-7", "terminal-note")).toBe(true);
    await flushPromises();
    expect(w.find('[data-testid="cell-memo-edit"]').exists()).toBe(false); // the editor replaced it
    expect(requestCellAction("cell-7", "terminal-reveal")).toBe(true);
    await flushPromises();
    const calls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(calls).toContain("/api/open-dir");
    w.unmount();
  });
});
