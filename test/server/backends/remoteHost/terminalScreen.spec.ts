// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  agentFromPaneCommand,
  buildSessionList,
  captureSessionScreen,
  definedScreenMeta,
  type CaptureScreenDeps,
  type SessionListInput,
} from "../../../../server/backends/remoteHost/terminalScreen.js";
import { undefinedPaths } from "@mulmoclaude/core/remote-host/server";

const ESC = String.fromCharCode(0x1b);

const listInput = (over: Partial<SessionListInput> = {}): SessionListInput => ({
  liveIds: [],
  tmuxIds: [],
  isResumable: () => true,
  isGridSession: () => true,
  detailOf: (id) => ({ title: id, cwd: "/w", agent: "shell" as const }),
  ...over,
});

// A session that outlived the server has no PtyEntry left, so the kind is recovered
// from what tmux says is running in it now.
describe("agentFromPaneCommand", () => {
  it("recognises the agents the phone treats specially", () => {
    expect(agentFromPaneCommand("claude")).toBe("claude");
    expect(agentFromPaneCommand("codex")).toBe("codex");
    // The pane runs `agy`, and the kind is "antigravity" — the one place the two names differ,
    // which is exactly why a session that outlived a restart used to come back as a shell.
    expect(agentFromPaneCommand("agy")).toBe("antigravity");
  });

  // A pane reports the RUNNING program's name, so an overridden binary has a different one.
  // The default stays recognised either way, or setting the variable would un-recognise every
  // session started before it.
  it("also recognises a binary the user pointed *_BIN at", () => {
    const previous = process.env.ANTIGRAVITY_BIN;
    process.env.ANTIGRAVITY_BIN = "/opt/bin/agy-next";
    try {
      expect(agentFromPaneCommand("agy-next")).toBe("antigravity");
      expect(agentFromPaneCommand("agy")).toBe("antigravity");
    } finally {
      if (previous === undefined) delete process.env.ANTIGRAVITY_BIN;
      else process.env.ANTIGRAVITY_BIN = previous;
    }
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

  // The phone drives the grid's cells: a live single-view chat session is not one of them
  // and must not show up, even though it is live and resumable.
  it("drops a live session that is not a grid cell", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["grid", "chat"], isGridSession: (id) => id === "grid" }));
    expect(sessions.map((s) => s.id)).toEqual(["grid"]);
  });

  // A grid cell that outlived a restart lives only in tmux; the persisted dev-terminal set
  // still names it, so it stays offerable while a non-grid tmux shell alongside it is dropped.
  it("keeps a tmux-only grid session and drops a non-grid tmux shell", () => {
    const sessions = buildSessionList(listInput({ tmuxIds: ["grid", "shell"], isGridSession: (id) => id === "grid" }));
    expect(sessions.map((s) => s.id)).toEqual(["grid"]);
  });

  // Resumable keeps anything with a transcript on disk, which on a working machine is
  // dozens of finished sessions the host can no longer name. A bare UUID is not a
  // choice the user can make.
  it("drops a nameless session that is not running", () => {
    const sessions = buildSessionList(
      listInput({ tmuxIds: ["named", "nameless"], detailOf: (id) => ({ title: id === "named" ? "Fix parser" : "", cwd: "", agent: null }) }),
    );
    expect(sessions.map((session) => session.id)).toEqual(["named"]);
  });

  // Live earns a row regardless: the id at least points at something running now.
  it("keeps a nameless session while it is live, labelled by its id", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["abc"], detailOf: () => ({ title: "", cwd: "/w", agent: "shell" }) }));
    expect(sessions).toEqual([{ id: "abc", title: "abc", cwd: "/w", live: true, agent: "shell" }]);
  });

  // A session that outlived a host restart keeps its recorded title, so it stays offerable.
  it("keeps a named session that is no longer live", () => {
    const sessions = buildSessionList(listInput({ tmuxIds: ["survivor"], detailOf: () => ({ title: "Overnight build", cwd: "/w", agent: null }) }));
    expect(sessions.map((session) => session.title)).toEqual(["Overnight build"]);
  });

  it("orders live sessions first, then by title", () => {
    const titles: Record<string, string> = { z: "zulu", a: "alpha", m: "mike" };
    const sessions = buildSessionList(listInput({ liveIds: ["z"], tmuxIds: ["a", "m"], detailOf: (id) => ({ title: titles[id], cwd: "/w", agent: "shell" }) }));
    expect(sessions.map((s) => s.title)).toEqual(["zulu", "alpha", "mike"]);
  });

  it("carries the per-session title and cwd through", () => {
    const sessions = buildSessionList(listInput({ liveIds: ["a"], detailOf: () => ({ title: "Fix the parser", cwd: "/repo", agent: "shell" }) }));
    expect(sessions[0]).toMatchObject({ title: "Fix the parser", cwd: "/repo" });
  });
});

const captureDeps = (over: Partial<CaptureScreenDeps> = {}): CaptureScreenDeps => ({
  captureStyledPane: () => null,
  sourceOf: () => ({ buffer: "buffered", cols: 80, rows: 24 }),
  render: async ({ buffer }) => [{ text: `rendered:${buffer}`, dim: "" }],
  ...over,
});

describe("captureSessionScreen", () => {
  it("prefers tmux, which renders the real screen even while detached", async () => {
    const render = vi.fn();
    const captured = await captureSessionScreen("a", captureDeps({ captureStyledPane: () => "from tmux\n\n", render }));
    expect(captured.screen).toBe("from tmux");
    expect(render).not.toHaveBeenCalled();
  });

  it("renders the in-process buffer when tmux has no such session", async () => {
    expect((await captureSessionScreen("a", captureDeps())).screen).toBe("rendered:buffered");
  });

  // The session can end between the phone listing it and reading it.
  it("reports a session that exists in neither place", async () => {
    await expect(captureSessionScreen("gone", captureDeps({ sourceOf: () => undefined }))).rejects.toThrow(/'gone' not found/);
  });

  it("passes the terminal's own geometry to the renderer", async () => {
    const render = vi.fn(async () => []);
    await captureSessionScreen("a", captureDeps({ sourceOf: () => ({ buffer: "b", cols: 120, rows: 30 }), render }));
    expect(render).toHaveBeenCalledWith({ buffer: "b", cols: 120, rows: 30 });
  });

  // An empty pane is a real answer, not a miss — it must not fall through to the buffer.
  it("treats an empty tmux capture as authoritative", async () => {
    const render = vi.fn();
    expect((await captureSessionScreen("a", captureDeps({ captureStyledPane: () => "", render }))).screen).toBe("");
    expect(render).not.toHaveBeenCalled();
  });

  // The phone has no Tab key, so the agent's ghost text has to arrive as its own value.
  it("hands the agent's dim suggestion over beside the screen", async () => {
    const styled = `${ESC}[38;5;246m────${ESC}[39m\n${ESC}[39m❯ ${ESC}[2mwrite the tests${ESC}[0m\n${ESC}[38;5;246m────${ESC}[39m`;
    const captured = await captureSessionScreen("a", captureDeps({ captureStyledPane: () => styled }));
    expect(captured).toEqual({ screen: "────\n❯ write the tests\n────", suggestion: "write the tests", quickCommands: [] });
  });

  it("reports no suggestion when the fallback renderer is the source", async () => {
    expect((await captureSessionScreen("a", captureDeps())).suggestion).toBe("");
  });

  // The phone's per-session view heads the screen with the same four things the grid cell
  // shows (#786) — read for the session being captured, and only for that one.
  it("carries the session's cwd, branch, summary and prompt beside the screen", async () => {
    const metaOf = vi.fn(async () => ({ cwd: "/repo", branch: "feat/786", summary: "Adding meta", prompt: "add branch to the phone view" }));
    const captured = await captureSessionScreen("a", captureDeps({ metaOf }));
    expect(captured).toEqual({
      screen: "rendered:buffered",
      suggestion: "",
      quickCommands: [],
      cwd: "/repo",
      branch: "feat/786",
      summary: "Adding meta",
      prompt: "add branch to the phone view",
    });
    expect(metaOf).toHaveBeenCalledWith("a");
  });

  // A host that answers nothing looks exactly like one built before #786 — the phone
  // renders the screen alone.
  it("sends only the screen when the host has no metadata to add", async () => {
    const captured = await captureSessionScreen("a", captureDeps({ metaOf: async () => ({ cwd: "", branch: "", summary: "", prompt: "" }) }));
    expect(captured).toEqual({ screen: "rendered:buffered", suggestion: "", quickCommands: [] });
  });

  it("sends only the screen when no metadata reader is wired at all", async () => {
    expect(await captureSessionScreen("a", captureDeps())).toEqual({ screen: "rendered:buffered", suggestion: "", quickCommands: [] });
  });

  // Metadata decorates the screen: a git call that blew up or a dir that has since been
  // deleted must not cost the phone the terminal output it asked for.
  it("still returns the screen when reading the metadata throws", async () => {
    const metaOf = vi.fn(async () => {
      throw new Error("git exploded");
    });
    expect(await captureSessionScreen("a", captureDeps({ metaOf }))).toEqual({ screen: "rendered:buffered", suggestion: "", quickCommands: [] });
  });

  // Reading the metadata shells out to git, so it must not queue behind the capture.
  it("reads the metadata concurrently with the screen", async () => {
    const order: string[] = [];
    const captured = await captureSessionScreen(
      "a",
      captureDeps({
        render: async () => {
          order.push("render:start");
          await Promise.resolve();
          order.push("render:end");
          return [{ text: "screen", dim: "" }];
        },
        metaOf: async () => {
          order.push("meta:start");
          return { branch: "main" };
        },
      }),
    );
    expect(order).toEqual(["render:start", "meta:start", "render:end"]);
    expect(captured.branch).toBe("main");
  });
});

// The response is written into a Firestore command doc, which rejects `undefined` outright,
// and the phone renders one labelled row per field it receives.
describe("definedScreenMeta", () => {
  it("keeps the fields the host could answer", () => {
    const meta = { cwd: "/repo", branch: "main", summary: "Fix the parser", prompt: "fix it" };
    expect(definedScreenMeta(meta)).toEqual(meta);
  });

  it("drops a field the host has no value for, key and all", () => {
    expect(definedScreenMeta({ cwd: "/repo", branch: undefined, summary: "", prompt: "   " })).toEqual({ cwd: "/repo" });
    expect(Object.keys(definedScreenMeta({ cwd: "/repo", branch: undefined }))).toEqual(["cwd"]);
  });

  it("returns nothing for an empty read", () => {
    expect(definedScreenMeta({})).toEqual({});
  });

  // The phone's whole rule for the GitHub link is "render it if the key is there" (#832), so
  // a dir that isn't a GitHub repo must lose the key rather than arrive as "".
  // The value is the repository ROOT, never a /tree/<branch>: a branch URL 404s whenever the
  // branch is gone from GitHub, which the host cannot see — refs/remotes/origin/* is a local
  // cache that outlives a branch deleted at merge time.
  it("drops githubUrl for a dir the host can't place on GitHub, and keeps a real one", () => {
    expect(definedScreenMeta({ cwd: "/repo", githubUrl: "" })).toEqual({ cwd: "/repo" });
    expect(definedScreenMeta({ cwd: "/repo", githubUrl: "https://github.com/o/r" })).toEqual({
      cwd: "/repo",
      githubUrl: "https://github.com/o/r",
    });
  });

  // Emptiness is judged on the trimmed value, but the value itself is passed through as-is:
  // a prompt's own leading spaces are the user's text, not ours to edit.
  it("passes a value with surrounding whitespace through unchanged", () => {
    expect(definedScreenMeta({ prompt: "  fix it  " })).toEqual({ prompt: "  fix it  " });
  });
});

// The regression itself (#1042). `expect(s.work).toBeUndefined()` passes for BOTH shapes, so it
// has to be `Object.hasOwn` — the broken form is a present key HOLDING undefined, which Firestore
// refuses, taking the whole reply down with it rather than just that field.
//
// Asserted against core's own `undefinedPaths` because core is what guards this write now (#1064):
// the check and the shipping guard are then the same code, not two descriptions of one rule.
describe("buildSessionList — the shape that reached Firestore (#1042)", () => {
  const WORK = { pr: 987, issue: 979, phase: "ready" as const, headline: "hi" };

  const listWith = (work: Map<string, typeof WORK>) =>
    buildSessionList({
      liveIds: ["with-work", "without-work"],
      tmuxIds: [],
      isResumable: () => true,
      isGridSession: () => true,
      detailOf: (id) => {
        const summary = work.get(`/work/${id}`);
        return { title: `session ${id}`, cwd: `/work/${id}`, agent: "claude" as const, ...(summary ? { work: summary } : {}) };
      },
    });

  it("omits the key entirely for a session with no work item", () => {
    const bare = listWith(new Map([["/work/with-work", WORK]])).find((session) => session.id === "without-work");
    expect(bare).toBeDefined();
    expect(bare && Object.hasOwn(bare, "work")).toBe(false);
  });

  it("still carries the work item for the session that has one", () => {
    expect(listWith(new Map([["/work/with-work", WORK]])).find((session) => session.id === "with-work")?.work).toEqual(WORK);
  });

  // The end-to-end statement: whatever the mix, the reply is one Firestore will accept.
  it("produces a list core's guard finds nothing to strip in", () => {
    expect(undefinedPaths({ sessions: listWith(new Map([["/work/with-work", WORK]])) })).toEqual([]);
    expect(undefinedPaths({ sessions: listWith(new Map()) })).toEqual([]);
  });
});
