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
  const component = defineComponent({
    setup() {
      activity = useGridActivity(ref(ids)).activity;
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  return { wrapper, get: () => activity };
}

const push = (data: unknown) => subscribers.get("sessions")?.(data);

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

  it("applies a push that arrives after the seed has landed", async () => {
    const { answer } = deferredSeed({ [SESSION]: IDLE });
    const { get } = mountGrid();
    answer();
    await flushPromises();

    push({ id: SESSION, working: true, waiting: false, event: "started" });
    expect(get().get(SESSION)?.working).toBe(true);
  });
});
