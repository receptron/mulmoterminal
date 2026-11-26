// The grid's status and the tab icon for remote cells (#3506 phase 2). Each is fed by relayed rows
// keyed by host and id, kept apart from this server's `sessions` rows keyed by bare id.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useGridCellStatus } from "../../../src/composables/useGridCellStatus";
import { useFaviconState } from "../../../src/composables/useFaviconState";
import { activityPushOfRow } from "../../../src/composables/useRemoteCellActivity";
import { activityKeyOf, remoteCellSessions } from "../../../src/components/remoteCell";
import { resolveCellStatus, type Cell } from "../../../src/components/gridTabs";
import type { AttentionStatus } from "../../../src/components/attentionStatus";

const bus = vi.hoisted(() => ({ listeners: new Map<string, Set<(data: unknown) => void>>() }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, listener: (data: unknown) => void) => {
      const set = bus.listeners.get(channel) ?? new Set();
      set.add(listener);
      bus.listeners.set(channel, set);
      return () => set.delete(listener);
    },
    onReconnect: () => () => {},
  }),
}));
const favicon = vi.hoisted(() => ({ color: null as Ref<string> | null }));
vi.mock("../../../src/composables/useDynamicFavicon", () => ({
  useDynamicFavicon: (color: Ref<string>) => {
    favicon.color = color;
  },
}));

const A = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const B = "1c8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const publish = (channel: string, data: unknown) => bus.listeners.get(channel)?.forEach((listener) => listener(data));
const row = (id: string, fields: Record<string, unknown>) => ({ id, working: false, waiting: false, event: null, ...fields });

let remoteSeed: Record<string, unknown> = {};
beforeEach(() => {
  bus.listeners.clear();
  remoteSeed = {};
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/remote-hosts/lx/activity")) return { ok: true, json: async () => remoteSeed };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

const CELLS: Cell[] = [
  { uid: 0, session: A, cwd: "/a" },
  { uid: 1, session: A, cwd: "/srv/a", remoteHost: "lx" },
  { uid: 2, session: B, cwd: "/srv/b", remoteHost: "lx" },
];

async function gridStatus(cells: Cell[], byUid: Record<number, AttentionStatus> = {}) {
  const held: { status: Ref<Record<number, AttentionStatus>> | null } = { status: null };
  const Harness = defineComponent({
    setup() {
      const all = ref(cells);
      held.status = useGridCellStatus(all, ref(cells.filter((cell) => !cell.remoteHost)), byUid);
      return () => h("div");
    },
  });
  mount(Harness);
  await flushPromises();
  return () => held.status?.value ?? {};
}

describe("the grid's status of remote cells", () => {
  it("starts from the forwarded activity, per host and id", async () => {
    remoteSeed = { [B]: { working: false, waiting: true, event: "Notification" } };
    const status = await gridStatus(CELLS);
    expect(status()).toEqual({ 0: "idle", 1: "idle", 2: "blocked" });
  });

  it("follows relayed rows without touching a local cell that shares the id", async () => {
    const status = await gridStatus(CELLS);
    publish("remote-sessions", { host: "lx", row: row(A, { working: true, event: "UserPromptSubmit" }) });
    await flushPromises();
    expect(status()).toEqual({ 0: "idle", 1: "working", 2: "idle" });
    publish("sessions", row(A, { waiting: true, event: "Notification" }));
    await flushPromises();
    expect(status()).toEqual({ 0: "blocked", 1: "working", 2: "idle" });
  });

  // As useGridActivity does for a local one: the entry goes, so the cell's own report is used again.
  it("drops a remote session's state when it closes, and ignores rows of sessions not on the grid", async () => {
    const status = await gridStatus(CELLS, { 2: "done" });
    publish("remote-sessions", { host: "lx", row: row(B, { working: true, event: "UserPromptSubmit" }) });
    publish("remote-sessions", { host: "lx", row: row("2c8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69", { working: true }) });
    await flushPromises();
    expect(status()[2]).toBe("working");
    publish("remote-sessions", { host: "lx", row: row(B, { event: "closed" }) });
    await flushPromises();
    expect(status()[2]).toBe("done");
  });
});

describe("activityKeyOf", () => {
  // The grid's statuses used to be resolved off the cells as they are; a local cell must still be.
  const sessions = [null, A, B, ""];
  const locals: Cell[] = sessions.flatMap((session, uid) => [{ uid, session, cwd: null }]);
  const bySession = new Map<string, AttentionStatus>([
    [A, "working"],
    [B, "blocked"],
    ["", "done"],
  ]);
  it("leaves a local cell's status exactly as resolving the cells themselves gave", () => {
    const byUid: Record<number, AttentionStatus> = { 0: "done" };
    const keyed = locals.map((cell) => ({ uid: cell.uid, session: activityKeyOf(cell) }));
    expect(resolveCellStatus(keyed, bySession, byUid)).toEqual(resolveCellStatus(locals, bySession, byUid));
  });
  it("keys a remote cell by host and id, and lists only remote cells with a session", () => {
    expect(activityKeyOf({ session: A, remoteHost: "lx" })).not.toBe(A);
    expect(activityKeyOf({ session: null, remoteHost: "lx" })).toBeNull();
    expect(remoteCellSessions([...CELLS, { uid: 3, session: null, cwd: null, remoteHost: "lx" }])).toEqual([
      { host: "lx", id: A },
      { host: "lx", id: B },
    ]);
  });
});

describe("activityPushOfRow", () => {
  it("carries the activity, and a text field only when the row has it", () => {
    expect(activityPushOfRow({ id: A, working: true, waiting: false, event: "x" })).toEqual({ working: true, waiting: false, event: "x" });
    expect(activityPushOfRow({ id: A, working: false, waiting: false, event: null, memo: null, aiTitle: "t", cwd: "/srv", lastResponse: "r" })).toEqual({
      working: false,
      waiting: false,
      event: null,
      memo: null,
      aiTitle: "t",
    });
  });
});

describe("the tab icon", () => {
  const mountFavicon = async () => {
    mount(
      defineComponent({
        setup() {
          useFaviconState(ref([]));
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    return () => favicon.color?.value;
  };

  it("counts a remote session that is waiting, and forgets it on close or on the host's resync", async () => {
    const color = await mountFavicon();
    const idle = color();
    publish("remote-sessions", { host: "lx", row: row(A, { waiting: true, event: "Notification" }) });
    await flushPromises();
    const attention = color();
    expect(attention).not.toBe(idle);
    publish("remote-sessions", { host: "lx", resync: true });
    await flushPromises();
    expect(color()).toBe(idle);
    publish("remote-sessions", { host: "lx", row: row(A, { working: true }) });
    publish("remote-sessions", { host: "lx", row: row(A, { event: "closed" }) });
    await flushPromises();
    expect(color()).toBe(idle);
  });

  it("keeps a session of another host when one host resyncs", async () => {
    const color = await mountFavicon();
    const idle = color();
    publish("remote-sessions", { host: "ly", row: row(A, { waiting: true }) });
    publish("remote-sessions", { host: "lx", resync: true });
    await flushPromises();
    expect(color()).not.toBe(idle);
  });
});
