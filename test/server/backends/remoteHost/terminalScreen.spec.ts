// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  agentFromPaneCommand,
  buildSessionList,
  captureSessionScreen,
  type CaptureScreenDeps,
  type SessionListInput,
} from "../../../../server/backends/remoteHost/terminalScreen.js";

const listInput = (over: Partial<SessionListInput> = {}): SessionListInput => ({
  liveIds: [],
  tmuxIds: [],
  isResumable: () => true,
  detailOf: (id) => ({ title: id, cwd: "/w", agent: "shell" as const }),
  ...over,
});

// A session that outlived the server has no PtyEntry left, so the kind is recovered
// from what tmux says is running in it now.
describe("agentFromPaneCommand", () => {
  it("recognises the agents the phone treats specially", () => {
    expect(agentFromPaneCommand("claude")).toBe("claude");
    expect(agentFromPaneCommand("codex")).toBe("codex");
  });

  // Anything else is where typed commands belong, which is what "shell" means here —
  // zsh, bash, or a one-off program the phone has no special input for.
  it("treats anything else as a shell", () => {
    expect(agentFromPaneCommand("zsh")).toBe("shell");
    expect(agentFromPaneCommand("bash")).toBe("shell");
    expect(agentFromPaneCommand("vim")).toBe("shell");
  });

  // Null means "cannot tell", and must stay distinguishable from "shell": the phone
  // withholds suggestions rather than guessing.
  it("stays unknown when tmux has no answer", () => {
    expect(agentFromPaneCommand(null)).toBeNull();
    expect(agentFromPaneCommand("")).toBeNull();
  });
});

describe("buildSessionList", () => {
  it("returns nothing when there are no sessions", () => {
    expect(buildSessionList(listInput())).toEqual([]);
  });

  // The phone offers shell command suggestions only where they make sense, so it has
  // to be able to tell a zsh session from an agent — and to tell "unknown" apart from
  // both (mulmoserver#84).
  it("carries what each session is running, and null when the host cannot tell", () => {
    const agents: Record<string, "claude" | "shell" | null> = { a: "shell", b: "claude", c: null };
    const sessions = buildSessionList(
      listInput({
        liveIds: ["a", "b"],
        tmuxIds: ["c"],
        detailOf: (id) => ({ title: id, cwd: "/w", agent: agents[id] }),
      }),
    );
    expect(sessions.map((session) => [session.id, session.agent])).toEqual([
      ["a", "shell"],
      ["b", "claude"],
      ["c", null],
    ]);
  });

  it("marks live sessions and unions in the tmux-only ones", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["a"], tmuxIds: ["b"] }));
    expect(sessions).toEqual([
      { id: "a", title: "a", cwd: "/w", live: true, agent: "shell" },
      { id: "b", title: "b", cwd: "/w", live: false, agent: "shell" },
    ]);
  });

  // A session is both attached AND in tmux in the normal case — it must appear once.
  it("dedupes a session present in both sources", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["a"], tmuxIds: ["a"] }));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].live).toBe(true);
  });

  // Without this the picker fills with long-dead tmux shells.
  it("drops sessions an orphan cleanup would reap", () => {
    const sessions = buildSessionList(listInput({ tmuxIds: ["keep", "dead"], isResumable: (id) => id === "keep" }));
    expect(sessions.map((s) => s.id)).toEqual(["keep"]);
  });

  // Resumable keeps anything with a transcript on disk, which on a working machine is
  // dozens of finished sessions the host can no longer name. A bare UUID is not a
  // choice the user can make.
  it("drops a nameless session that is not running", () => {
    const sessions = buildSessionList(
      listInput({ tmuxIds: ["named", "nameless"], detailOf: (id) => ({ title: id === "named" ? "Fix parser" : "", cwd: "" }) }),
    );
    expect(sessions.map((session) => session.id)).toEqual(["named"]);
  });

  // Live earns a row regardless: the id at least points at something running now.
  it("keeps a nameless session while it is live, labelled by its id", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["abc"], detailOf: () => ({ title: "", cwd: "/w" }) }));
    expect(sessions).toEqual([{ id: "abc", title: "abc", cwd: "/w", live: true }]);
  });

  // A session that outlived a host restart keeps its recorded title, so it stays offerable.
  it("keeps a named session that is no longer live", () => {
    const sessions = buildSessionList(listInput({ tmuxIds: ["survivor"], detailOf: () => ({ title: "Overnight build", cwd: "/w" }) }));
    expect(sessions.map((session) => session.title)).toEqual(["Overnight build"]);
  });

  it("orders live sessions first, then by title", () => {
    const titles: Record<string, string> = { z: "zulu", a: "alpha", m: "mike" };
    const sessions = buildSessionList(listInput({ liveIds: ["z"], tmuxIds: ["a", "m"], detailOf: (id) => ({ title: titles[id], cwd: "/w" }) }));
    expect(sessions.map((s) => s.title)).toEqual(["zulu", "alpha", "mike"]);
  });

  it("carries the per-session title and cwd through", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["a"], detailOf: () => ({ title: "Fix the parser", cwd: "/repo" }) }));
    expect(sessions[0]).toMatchObject({ title: "Fix the parser", cwd: "/repo" });
  });
});

const captureDeps = (over: Partial<CaptureScreenDeps> = {}): CaptureScreenDeps => ({
  capturePane: () => null,
  sourceOf: () => ({ buffer: "buffered", cols: 80, rows: 24 }),
  render: async ({ buffer }) => `rendered:${buffer}`,
  ...over,
});

describe("captureSessionScreen", () => {
  it("prefers tmux, which renders the real screen even while detached", async () => {
    const render = vi.fn();
    const screen = await captureSessionScreen("a", captureDeps({ capturePane: () => "from tmux\n\n", render }));
    expect(screen).toBe("from tmux");
    expect(render).not.toHaveBeenCalled();
  });

  it("renders the in-process buffer when tmux has no such session", async () => {
    expect(await captureSessionScreen("a", captureDeps())).toBe("rendered:buffered");
  });

  // The session can end between the phone listing it and reading it.
  it("reports a session that exists in neither place", async () => {
    await expect(captureSessionScreen("gone", captureDeps({ sourceOf: () => undefined }))).rejects.toThrow(/'gone' not found/);
  });

  it("passes the terminal's own geometry to the renderer", async () => {
    const render = vi.fn(async () => "ok");
    await captureSessionScreen("a", captureDeps({ sourceOf: () => ({ buffer: "b", cols: 120, rows: 30 }), render }));
    expect(render).toHaveBeenCalledWith({ buffer: "b", cols: 120, rows: 30 });
  });

  // An empty pane is a real answer, not a miss — it must not fall through to the buffer.
  it("treats an empty tmux capture as authoritative", async () => {
    const render = vi.fn();
    expect(await captureSessionScreen("a", captureDeps({ capturePane: () => "", render }))).toBe("");
    expect(render).not.toHaveBeenCalled();
  });
});
