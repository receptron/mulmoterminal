// What ONE session is doing, for a chat that runs in the collection pane rather than in the grid
// (#2001). The roster answers this for cells by keeping a map it prunes AGAINST the cells, which is
// why a pane session cannot live in it — these cases are the separate lifetime, and the two guards
// the roster's own seed carries: nulls merge rather than overwrite, and an overtaken answer is
// dropped.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useSessionSummary } from "../../../src/composables/useSessionSummary";

type Body = Record<string, unknown>;
/** The composable's own interval. Not exported by it — a spec that waits out the poll has to name
 *  the same number, and this is where it is said. */
const POLL_MS = 4000;
/** What the endpoint answers, per session id — and, when a test wants to control the timing, a
 *  promise it holds open. */
let answers: Record<string, Body> = {};
let held: { resolve: (body: Body) => void; id: string }[] = [];
let holding = false;

const flush = async (): Promise<void> => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const inScope = <T>(body: () => T): { value: T; stop: () => void } => {
  const scope = effectScope();
  const value = scope.run(body) as T;
  return { value, stop: () => scope.stop() };
};

beforeEach(() => {
  answers = {};
  held = [];
  holding = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const id = String(url).split("/").pop() ?? "";
      const body = holding ? new Promise<Body>((resolve) => held.push({ resolve, id })) : Promise.resolve(answers[id] ?? {});
      return Promise.resolve({ ok: true, json: () => body });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("useSessionSummary", () => {
  it("reports what the session's transcript says", async () => {
    answers.a = { aiTitle: "Rewriting the parser", lastPrompt: "make it faster" };
    const { value: meta, stop } = inScope(() => useSessionSummary(ref("a")));
    await flush();
    expect(meta.value.aiTitle).toBe("Rewriting the parser");
    expect(meta.value.lastPrompt).toBe("make it faster");
    stop();
  });

  it("asks nothing when there is no session to ask about", async () => {
    const { value: meta, stop } = inScope(() => useSessionSummary(ref(null)));
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(meta.value.aiTitle).toBeNull();
    stop();
  });

  // A transcript this build cannot find answers with nulls. Overwriting on that would blank a
  // summary already on screen, which reads as "the agent stopped" rather than "we did not hear".
  it("keeps what it had when the next answer knows less", async () => {
    // Waited out on the poll, not re-triggered by moving the id: setting it away and back in one
    // tick ends on the value it already had, so the watcher never runs and the "second" answer
    // never arrives — the assertion would pass on the first one alone (CodeRabbit, PR #2002).
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    answers.a = { aiTitle: "Rewriting the parser" };
    const { value: meta, stop } = inScope(() => useSessionSummary(ref("a")));
    await flush();
    answers.a = {}; // the transcript can no longer be read
    vi.advanceTimersByTime(POLL_MS);
    await flush();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2); // it really did ask again
    expect(meta.value.aiTitle).toBe("Rewriting the parser");
    stop();
    vi.useRealTimers();
  });

  // Polls overlap. An older answer describes a moment that has already been overtaken, so applying
  // it puts back what the newer one replaced.
  it("ignores an answer that has been overtaken", async () => {
    holding = true;
    const id = ref<string | null>("a");
    const { value: meta, stop } = inScope(() => useSessionSummary(id));
    await flush();
    holding = false;
    answers.b = { aiTitle: "the session you are looking at" };
    id.value = "b"; // the pane switched tabs while the first read was still out
    await flush();
    held.forEach((pending) => pending.resolve({ aiTitle: "the session you left" }));
    await flush();
    expect(meta.value.aiTitle).toBe("the session you are looking at");
    stop();
  });

  it("shows nothing from the previous session while the new one is still unread", async () => {
    answers.a = { aiTitle: "Rewriting the parser" };
    const id = ref<string | null>("a");
    const { value: meta, stop } = inScope(() => useSessionSummary(id));
    await flush();
    holding = true;
    id.value = "b";
    await nextTick();
    expect(meta.value.aiTitle).toBeNull();
    stop();
  });

  // The poll outlives its owner unless something stops it, and a pane is opened and closed all day.
  // Only the interval is faked: the flush above needs a real `setTimeout` to let the fetch land.
  it("stops reading once the pane is gone", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    answers.a = { aiTitle: "Rewriting the parser" };
    const { stop } = inScope(() => useSessionSummary(ref("a")));
    await flush();
    const before = vi.mocked(fetch).mock.calls.length;
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    vi.advanceTimersByTime(20_000);
    await flush();
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before); // it IS polling
    const polled = vi.mocked(fetch).mock.calls.length;
    stop();
    vi.advanceTimersByTime(20_000);
    await flush();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(polled);
    vi.useRealTimers();
  });
});
