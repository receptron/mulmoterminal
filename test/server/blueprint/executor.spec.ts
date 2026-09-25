// @vitest-environment node
// The executor against fakes: sessions are recorded instead of spawned, a turn ends when the test
// says so, and checks answer from a table. What is under test is the order of things — never a
// check before the turn ends, never a spawn past a gate, never a check for a session that stopped
// to ask.
import { describe, it, expect, beforeEach } from "vitest";
import { createExecutor, LOST_SESSION_OUTPUT, type BlueprintExecutor, type ExecutorDeps } from "../../../server/blueprint/executor";
import type { RunStore } from "../../../server/blueprint/runStore";
import type { BlueprintRun } from "../../../common/blueprint/run";
import type { BlueprintState } from "../../../common/blueprint/state";
import { MAX_FAILED_CHECKS } from "../../../common/blueprint/executorPolicy";
import type { ComposedStep } from "../../../common/blueprint/plan";

const step = (id: string, gates: ComposedStep["gates"] = []): ComposedStep => ({
  id,
  title: id,
  description: "",
  skill: `skills/${id}`,
  check: `check-${id}`,
  gates,
  origin: "base",
});

const STEPS = [step("a"), step("b", ["billing", "review"]), step("c")];

function memoryStore(): RunStore & { saved: Map<string, { run: BlueprintRun; state: BlueprintState }> } {
  const saved = new Map<string, { run: BlueprintRun; state: BlueprintState }>();
  return {
    saved,
    list: async () => [...saved.keys()],
    load: async (id) => structuredClone(saved.get(id) ?? null),
    save: async (run, state) => void saved.set(run.id, structuredClone({ run, state })),
  };
}

let spawned: { cwd: string; prompt: string; sessionId: string }[];
let turnHooks: Map<string, (outcome: { didError: boolean }) => Promise<void>>;
let store: ReturnType<typeof memoryStore>;
let deps: ExecutorDeps;
let checkGate: Promise<void> | null;
let files: Map<string, string>;
let checkResults: Record<string, boolean[]>;
let checksRun: string[];
let executor: BlueprintExecutor;
let clock: number;

beforeEach(() => {
  spawned = [];
  turnHooks = new Map();
  checkResults = {};
  checksRun = [];
  clock = 1000;
  checkGate = null;
  files = new Map();
  store = memoryStore();
  deps = {
    store,
    spawnStepSession: (cwd, prompt, sessionId) => void spawned.push({ cwd, prompt, sessionId }),
    newSessionId: () => `s${spawned.length + 1}`,
    projectFiles: {
      read: async (_dir, relativePath) => files.get(relativePath) ?? null,
      remove: async (_dir, relativePath) => void files.delete(relativePath),
    },
    onTurnEnded: (sessionId, callback) => void turnHooks.set(sessionId, callback),
    runCheck: async ({ command }) => {
      checksRun.push(command);
      if (checkGate) await checkGate;
      const ok = checkResults[command]?.shift() ?? true;
      return { ok, output: ok ? "" : `${command} failed` };
    },
    askCommand: (runId, stepId, sessionId) => `ask ${runId} ${stepId} ${sessionId}`,
    newRunId: () => "run-00000001",
    now: () => ++clock,
  };
  executor = createExecutor(deps);
});

const create = () => executor.create({ projectDir: "/work/app", basePackDir: "/packs/firebase", usecasePackDir: "/packs/internal", steps: STEPS });
const endTurn = async (sessionId: string, didError = false) => {
  const hook = turnHooks.get(sessionId);
  if (!hook) throw new Error(`no hook for ${sessionId}`);
  await hook({ didError });
};
const statusOf = async (id: string) => (await executor.view("run-00000001")).state.steps[id]?.status;

describe("blueprint executor", () => {
  it("starts the first step in a session in the project directory, with the skill from its pack", async () => {
    await create();
    expect(spawned).toHaveLength(1);
    expect(spawned[0].cwd).toBe("/work/app");
    expect(spawned[0].prompt).toContain("/packs/firebase/skills/a/SKILL.md");
    expect(checksRun).toEqual([]);
  });

  it("runs the check only when the turn ends, then stops at the next gate without spawning", async () => {
    await create();
    await endTurn("s1");
    expect(checksRun).toEqual(["check-a"]);
    expect(await statusOf("a")).toBe("passed");
    expect(await statusOf("b")).toBe("awaiting-approval");
    expect(spawned).toHaveLength(1);
  });

  it("continues past the gate once a person approves", async () => {
    await create();
    await endTurn("s1");
    await executor.humanEvent("run-00000001", "b", { type: "approve" });
    expect(spawned.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
    await endTurn("s2");
    expect(spawned).toHaveLength(3);
    expect(spawned[2].prompt).toContain('"c"');
  });

  it("retries a failing check with its output, then stops for a person", async () => {
    checkResults["check-a"] = Array.from({ length: MAX_FAILED_CHECKS }, () => false);
    await create();
    for (let attempt = 1; attempt <= MAX_FAILED_CHECKS; attempt++) await endTurn(`s${attempt}`);
    expect(spawned).toHaveLength(MAX_FAILED_CHECKS);
    expect(spawned[1].prompt).toContain("check-a failed");
    expect(await statusOf("a")).toBe("failed");
  });

  it("restarts the automatic retries when a person retries", async () => {
    checkResults["check-a"] = Array.from({ length: MAX_FAILED_CHECKS + 1 }, () => false);
    await create();
    for (let attempt = 1; attempt <= MAX_FAILED_CHECKS; attempt++) await endTurn(`s${attempt}`);
    await executor.humanEvent("run-00000001", "a", { type: "retry" });
    await endTurn(`s${MAX_FAILED_CHECKS + 1}`);
    // One more failure after a person's retry is retried automatically again.
    expect(spawned).toHaveLength(MAX_FAILED_CHECKS + 2);
    await endTurn(`s${MAX_FAILED_CHECKS + 2}`);
    expect(await statusOf("a")).toBe("passed");
  });

  it("does not check a session that stopped to ask, and hands the answer to a new one", async () => {
    await create();
    await executor.ask("run-00000001", "a", "Which region?", "s1");
    await endTurn("s1");
    expect(checksRun).toEqual([]);
    expect(await statusOf("a")).toBe("awaiting-answer");
    await executor.humanEvent("run-00000001", "a", { type: "answer", answer: "Tokyo", atMs: 0 });
    expect(spawned).toHaveLength(2);
    expect(spawned[1].prompt).toContain("A: Tokyo");
  });

  it("does not count a session that stopped to ask as a failed attempt", async () => {
    checkResults["check-a"] = Array.from({ length: MAX_FAILED_CHECKS - 1 }, () => false);
    await create();
    await executor.ask("run-00000001", "a", "Which region?", "s1");
    await endTurn("s1");
    await executor.humanEvent("run-00000001", "a", { type: "answer", answer: "Tokyo", atMs: 0 });
    for (let session = 2; session <= MAX_FAILED_CHECKS + 1; session++) await endTurn(`s${session}`);
    expect(await statusOf("a")).toBe("passed");
  });

  it("checks the session that received an answer, however the clocks line up", async () => {
    await create();
    await executor.ask("run-00000001", "a", "Which region?", "s1");
    await endTurn("s1");
    // An answer stamped at or after the next session's start (a tie to the millisecond, or a clock
    // step) must not be mistaken for an answer that arrived DURING that session.
    await executor.humanEvent("run-00000001", "a", { type: "answer", answer: "Tokyo", atMs: 10 ** 13 });
    await endTurn("s2");
    expect(checksRun).toEqual(["check-a"]);
  });

  it("still checks a session recorded before the answer count existed", async () => {
    await create();
    const saved = store.saved.get("run-00000001");
    if (!saved) throw new Error("not saved");
    const legacySessions = saved.run.sessions.map(({ answersAtStart: _count, ...rest }) => rest);
    store.saved.set("run-00000001", { run: { ...saved.run, sessions: legacySessions }, state: saved.state });
    await endTurn("s1");
    expect(checksRun).toEqual(["check-a"]);
  });

  it("does not check a session answered before its turn ended", async () => {
    await create();
    await executor.ask("run-00000001", "a", "Which region?", "s1");
    await executor.humanEvent("run-00000001", "a", { type: "answer", answer: "Tokyo", atMs: clock + 1 });
    await endTurn("s1");
    expect(checksRun).toEqual([]);
    expect(spawned).toHaveLength(2);
  });

  it("ignores a late turn ending from an earlier session while a newer one works the step", async () => {
    checkResults["check-a"] = [false];
    await create();
    await endTurn("s1");
    expect(spawned.map((entry) => entry.sessionId)).toEqual(["s1", "s2"]);
    await endTurn("s1");
    expect(checksRun).toEqual(["check-a"]);
    expect((await executor.view("run-00000001")).run.activeSessionId).toBe("s2");
  });

  it("ignores a turn ending for a session that is no longer the active one", async () => {
    await create();
    await endTurn("s1");
    await endTurn("s1");
    expect(checksRun).toEqual(["check-a"]);
  });

  it("lets the working agent replace a question nobody has answered yet", async () => {
    await create();
    await executor.ask("run-00000001", "a", "x", "s1");
    await executor.ask("run-00000001", "a", "Link billing at these URLs, then say done.", "s1");
    const { state } = await executor.view("run-00000001");
    expect(state.steps.a).toMatchObject({ status: "awaiting-answer", question: "Link billing at these URLs, then say done." });
  });

  it("stops without starting a session when the folder is no longer trusted, until a person retries", async () => {
    let trusted = true;
    executor = createExecutor({ ...deps, isTrusted: async () => trusted });
    await create();
    trusted = false;
    await endTurn("s1");
    const stopped = await executor.view("run-00000001");
    expect(spawned).toHaveLength(1);
    expect(stopped.state.steps.b.status).toBe("awaiting-approval");
    await executor.humanEvent("run-00000001", "b", { type: "approve" });
    const refused = await executor.view("run-00000001");
    expect(spawned).toHaveLength(1);
    expect(refused.state.steps.b).toMatchObject({ status: "failed", lastCheck: { ok: false, output: expect.stringContaining("does not trust /work/app") } });
    trusted = true;
    await executor.humanEvent("run-00000001", "b", { type: "retry" });
    expect(spawned).toHaveLength(2);
  });

  it("refuses a question from a session that is not the one working on the step", async () => {
    checkResults["check-a"] = [false];
    await create();
    await endTurn("s1");
    await expect(executor.ask("run-00000001", "a", "stale?", "s1")).rejects.toThrow("not the one working");
    await executor.ask("run-00000001", "a", "fresh?", "s2");
    expect((await executor.view("run-00000001")).state.steps.a.question).toBe("fresh?");
  });

  describe("talking the spec over at its review gate", () => {
    // b carries the review gate here: a passes, then the build waits for b's approval.
    const atReview = async () => {
      executor = createExecutor(deps);
      await create();
      await endTurn("s1");
    };

    it("hands the message to a new session, then records the reply it wrote and clears the file", async () => {
      await atReview();
      await executor.say("run-00000001", "本の削除も入れて");
      expect(spawned[1].prompt).toContain("本の削除も入れて");
      files.set(".blueprint/reply-s2.md", "削除を足しました。");
      await endTurn("s2");
      const { run } = await executor.view("run-00000001");
      expect(run.specChat.map((entry) => [entry.role, entry.text, entry.outcome])).toEqual([
        ["person", "本の削除も入れて", undefined],
        ["agent", "削除を足しました。", "reply"],
      ]);
      expect(run.revisionSessionId).toBeNull();
      expect(files.has(".blueprint/reply-s2.md")).toBe(false);
    });

    it("carries the conversation so far into the next message's session", async () => {
      await atReview();
      await executor.say("run-00000001", "first");
      files.set(".blueprint/reply-s2.md", "done first");
      await endTurn("s2");
      await executor.say("run-00000001", "second");
      expect(spawned[2].prompt).toContain("User: first");
      expect(spawned[2].prompt).toContain("You: done first");
    });

    it("records a session that wrote no reply, and one that died, without inventing words", async () => {
      await atReview();
      await executor.say("run-00000001", "one");
      await endTurn("s2");
      await executor.say("run-00000001", "two");
      await endTurn("s3", true);
      const outcomes = (await executor.view("run-00000001")).run.specChat.filter((entry) => entry.role === "agent").map((entry) => entry.outcome);
      expect(outcomes).toEqual(["no-reply", "lost"]);
    });

    it("ignores a reply written by an earlier session into its own file", async () => {
      await atReview();
      await executor.say("run-00000001", "one");
      await endTurn("s2", true);
      await executor.say("run-00000001", "two");
      files.set(".blueprint/reply-s2.md", "late words from the lost session");
      files.set(".blueprint/reply-s3.md", "the real reply");
      await endTurn("s3");
      expect((await executor.view("run-00000001")).run.specChat.at(-1)?.text).toBe("the real reply");
      expect(spawned[2].prompt).toContain(".blueprint/reply-s3.md");
    });

    it("refuses a message while one is being answered, and approval until the reply is in", async () => {
      await atReview();
      await executor.say("run-00000001", "one");
      await expect(executor.say("run-00000001", "two")).rejects.toThrow("still being answered");
      await expect(executor.humanEvent("run-00000001", "b", { type: "approve" })).rejects.toThrow("still being revised");
    });

    it("refuses a message when the build is not waiting at a review gate", async () => {
      await create();
      await expect(executor.say("run-00000001", "hi")).rejects.toThrow("waits for review");
    });

    it("on recovery, records a reply the restart cut off as lost", async () => {
      await atReview();
      await executor.say("run-00000001", "one");
      await createExecutor(deps).recover(() => undefined);
      const { run } = await executor.view("run-00000001");
      expect(run.revisionSessionId).toBeNull();
      expect(run.specChat.at(-1)?.outcome).toBe("lost");
    });

    it("shows the spec and the open questions from the project", async () => {
      await atReview();
      files.set(".blueprint/spec.md", "# おうち図書館");
      expect(await executor.specView("run-00000001")).toEqual({ spec: "# おうち図書館", openQuestions: null, chat: [], revising: false });
    });
  });

  it("refuses a question when no agent is working", async () => {
    await create();
    await endTurn("s1");
    await expect(executor.ask("run-00000001", "b", "?", "s1")).rejects.toThrow("no agent is working");
  });

  it("refuses a person's event the rules do not allow", async () => {
    await create();
    await expect(executor.humanEvent("run-00000001", "c", { type: "approve" })).rejects.toThrow();
  });

  it("holds a person's event until a running check has settled", async () => {
    let releaseCheck = (): void => undefined;
    checkGate = new Promise((resolve) => (releaseCheck = resolve));
    await create();
    const ending = endTurn("s1");
    // Approving b now would be refused — a is not passed yet. Queued behind the check, it succeeds.
    const approving = executor.humanEvent("run-00000001", "b", { type: "approve" });
    await Promise.resolve();
    releaseCheck();
    await ending;
    const approved = await approving;
    expect(approved.state.steps.b.status).toBe("running");
    expect(spawned).toHaveLength(2);
  });

  it("does not run the check for a session that ended without finishing, and retries it", async () => {
    await create();
    await endTurn("s1", true);
    expect(checksRun).toEqual([]);
    const { run, state } = await executor.view("run-00000001");
    expect(state.steps.a.lastCheck).toMatchObject({ ok: false, output: LOST_SESSION_OUTPUT });
    expect(run.failedChecks).toEqual({ a: 1 });
    expect(spawned).toHaveLength(2);
  });

  it("on recovery, ends a session the restart orphaned and hands the step to a new one", async () => {
    await create();
    const restarted = createExecutor(deps);
    const ended: string[] = [];
    await restarted.recover((sessionId) => void ended.push(sessionId));
    expect(ended).toEqual(["s1"]);
    expect(checksRun).toEqual([]);
    expect(spawned).toHaveLength(2);
    expect((await restarted.view("run-00000001")).run.activeSessionId).toBe("s2");
  });

  it("on recovery, gives a session to a step that was started but never handed one", async () => {
    await create();
    const saved = store.saved.get("run-00000001");
    if (!saved) throw new Error("not saved");
    store.saved.set("run-00000001", { run: { ...saved.run, activeSessionId: null }, state: saved.state });
    await createExecutor(deps).recover(() => undefined);
    expect(spawned).toHaveLength(2);
    expect((await executor.view("run-00000001")).run.activeSessionId).toBe("s2");
  });

  it("recovery leaves a run with no active session alone", async () => {
    await create();
    await endTurn("s1");
    const ended: string[] = [];
    await createExecutor(deps).recover((sessionId) => void ended.push(sessionId));
    expect(ended).toEqual([]);
    expect(spawned).toHaveLength(1);
  });
});
