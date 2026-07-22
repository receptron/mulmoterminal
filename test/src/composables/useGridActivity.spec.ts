import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";

const subscribers = new Map<string, (data: unknown) => void>();

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      subscribers.set(channel, handler);
      return () => subscribers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));

import { useGridActivity } from "../../../src/composables/useGridActivity";
import type { CellActivity } from "../../../src/composables/sessionActivity";

const IDLE = { working: false, waiting: false, event: null };
const SESSION = "session-1";

// A seed response this test decides when to answer, so a push can be delivered while the
// request is still out — the window the bug lives in.
function deferredSeed(payload: Record<string, CellActivity>) {
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => payload };
    }),
  );
  return { answer };
}

function mountGrid(ids: string[] = [SESSION]) {
  let activity!: Map<string, CellActivity>;
  const sessionIds = ref(ids);
  const component = defineComponent({
    setup() {
      activity = useGridActivity(sessionIds).activity;
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  // Re-run the seed the way the cell-list watch does, so a second request overlaps the first.
  const seedAgain = async () => {
    sessionIds.value = [...sessionIds.value, `extra-${sessionIds.value.length}`];
    await wrapper.vm.$nextTick();
  };
  return { wrapper, get: () => activity, seedAgain };
}

const push = (data: unknown) => subscribers.get("sessions")?.(data);

// Sentinel for twoSeeds: the second request answers !ok.
const FAILS: Record<string, CellActivity> = {};

beforeEach(() => subscribers.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useGridActivity", () => {
  // The regression: /api/activity answers as of when it was ASKED, so a cell that started
  // working in the meantime was seeded straight back to idle (#620 F3).
  it("keeps a status that arrived while the seed was in flight", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE });
    const { get } = mountGrid();

    push({ id: SESSION, working: true, waiting: false, event: "started" });
    answer();
    await flushPromises();

    expect(get().get(SESSION)?.working).toBe(true);
  });

  // The same hole in the other direction: the seed still lists a session that has closed.
  it("does not bring back a session that closed while the seed was in flight", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE });
    const { get } = mountGrid();

    push({ id: SESSION, event: "closed" });
    answer();
    await flushPromises();

    expect(get().has(SESSION)).toBe(false);
  });

  it("replays what happened in the order it happened", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE });
    const { get } = mountGrid();

    push({ id: SESSION, working: true, waiting: false, event: "started" });
    push({ id: SESSION, event: "closed" });
    answer();
    await flushPromises();

    expect(get().has(SESSION)).toBe(false);
  });

  it("still seeds the state it fetched when nothing arrived meanwhile", async () => {
    const { answer } = deferredSeed({ [SESSION]: { working: true, waiting: false, event: "seeded" } });
    const { get } = mountGrid();

    answer();
    await flushPromises();

    expect(get().get(SESSION)?.working).toBe(true);
  });

  it("leaves other sessions the seed reported alone", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE, other: { working: true, waiting: false, event: null } });
    const { get } = mountGrid([SESSION, "other"]);

    push({ id: SESSION, working: true, waiting: false, event: "started" });
    answer();
    await flushPromises();

    expect(get().get("other")?.working).toBe(true);
    expect(get().get(SESSION)?.working).toBe(true);
  });

  // Codex on #626: seeds overlap (mount + the cell-list watch + reconnect), and an older
  // answer landing last put back what the newer state had replaced — the same rollback this
  // PR is about, one level up.
  describe("when seeds overlap", () => {
    // Two gates, so the test can land the OLDER answer last.
    function twoSeeds(first: Record<string, CellActivity>, second: Record<string, CellActivity>) {
      let answerFirst!: () => void;
      let answerSecond!: () => void;
      const firstGate = new Promise<void>((r) => (answerFirst = r));
      const secondGate = new Promise<void>((r) => (answerSecond = r));
      let call = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const mine = ++call;
          await (mine === 1 ? firstGate : secondGate);
          if (mine === 2 && second === FAILS) return { ok: false, status: 500 };
          return { ok: true, json: async () => (mine === 1 ? first : second) };
        }),
      );
      return { answerFirst, answerSecond };
    }

    it("ignores an older answer that lands after a newer one", async () => {
      const { answerFirst, answerSecond } = twoSeeds({ [SESSION]: IDLE }, { [SESSION]: { working: true, waiting: false, event: "newer" } });
      const { get, seedAgain } = mountGrid();
      await seedAgain();

      answerSecond();
      await flushPromises();
      expect(get().get(SESSION)?.working).toBe(true);

      answerFirst(); // the stale one, arriving last
      await flushPromises();
      expect(get().get(SESSION)?.working).toBe(true);
    });

    it("does not lose a push when the newer seed fails", async () => {
      const { answerFirst, answerSecond } = twoSeeds({ [SESSION]: IDLE }, FAILS);
      const { get, seedAgain } = mountGrid();
      await seedAgain();

      push({ id: SESSION, working: true, waiting: false, event: "started" });
      answerSecond(); // fails, so nothing is applied and nothing needs undoing
      await flushPromises();
      answerFirst(); // stale: must not put the idle snapshot back
      await flushPromises();

      expect(get().get(SESSION)?.working).toBe(true);
    });
  });

  it("applies a push that arrives after the seed has landed", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE });
    const { get } = mountGrid();
    answer();
    await flushPromises();

    push({ id: SESSION, working: true, waiting: false, event: "started" });
    expect(get().get(SESSION)?.working).toBe(true);
  });
});
