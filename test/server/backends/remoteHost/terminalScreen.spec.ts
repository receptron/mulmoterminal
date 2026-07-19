// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  buildSessionList,
  captureSessionScreen,
  type CaptureScreenDeps,
  type SessionListInput,
} from "../../../../server/backends/remoteHost/terminalScreen.js";

const listInput = (over: Partial<SessionListInput> = {}): SessionListInput => ({
  liveIds: [],
  tmuxIds: [],
  isResumable: () => true,
  detailOf: (id) => ({ title: id, cwd: "/w" }),
  ...over,
});

describe("buildSessionList", () => {
  it("returns nothing when there are no sessions", () => {
    expect(buildSessionList(listInput())).toEqual([]);
  });

  it("marks live sessions and unions in the tmux-only ones", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["a"], tmuxIds: ["b"] }));
    expect(sessions).toEqual([
      { id: "a", title: "a", cwd: "/w", live: true },
      { id: "b", title: "b", cwd: "/w", live: false },
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
