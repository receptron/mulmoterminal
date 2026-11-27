import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { RoomMessage } from "../../../common/roomMessage";

const POLL_MS = 2000;

// Route-driven like the other overlays; stub the seam so it is "open" on a room without a router.
const openRoom = ref<string | null>("standup");
const isOpen = ref(true);
vi.mock("../../../src/composables/useRoomsView", () => ({
  useRoomsView: () => ({ isOpen, room: openRoom, close: vi.fn() }),
  roomsViewSelect: vi.fn(),
}));

let messages: RoomMessage[] = [];
let readOk = true;
let postOk = true;
let posted: { room: string; from: string; text: string }[] = [];
let deleted: string[] = [];

// Two microtask hops, so a watcher run is still suspended when the next room change arrives —
// which is the race the generation token below is about.
const suspend = () => Promise.resolve().then(() => undefined);
let reads = 0;
/** What a room read waits on; each read answers with the messages as they were when it was asked. */
let roomGate: Promise<void> = Promise.resolve();
let postGate: Promise<void> = Promise.resolve();

vi.mock("../../../src/composables/useRooms", () => ({
  loadRoom: async () => {
    reads++;
    const asked = messages;
    const gate = roomGate;
    await suspend();
    await gate;
    return readOk ? { ok: true, messages: asked } : { ok: false };
  },
  listRooms: async () => {
    await suspend();
    return ["standup", "design-review"];
  },
  sendRoomMessage: async (room: string, from: string, text: string) => {
    await postGate;
    if (postOk) posted.push({ room, from, text });
    return postOk;
  },
  deleteRoom: async (room: string) => {
    deleted.push(room);
    return true;
  },
}));

const RoomsOverlay = (await import("../../../src/components/RoomsOverlay.vue")).default;

beforeEach(() => {
  openRoom.value = "standup";
  isOpen.value = true;
  messages = [];
  readOk = true;
  postOk = true;
  posted = [];
  deleted = [];
  reads = 0;
  roomGate = Promise.resolve();
  postGate = Promise.resolve();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const open = async () => {
  const w = mount(RoomsOverlay);
  await flushPromises();
  return w;
};

describe("RoomsOverlay", () => {
  // Closing hides the screen and the route drops the room; the conversation is still there, on the
  // same room, when it opens again — and is read again then.
  it("keeps the conversation across a close and reads it again on the next open", async () => {
    messages = [{ at: 1, from: "human", text: "still here" }];
    const w = await open();
    isOpen.value = false;
    openRoom.value = null;
    await flushPromises();
    expect(w.findAll('[data-testid="room-message"]').map((row) => row.text().includes("still here"))).toEqual([true]);
    const readsWhileClosed = reads;
    isOpen.value = true;
    openRoom.value = "standup";
    await flushPromises();
    expect(w.findAll('[data-testid="room-message"]')).toHaveLength(1);
    expect(reads).toBe(readsWhileClosed + 1);
    w.unmount();
  });

  // The screen outlives a close, so a read from an earlier opening can answer after a later one's.
  it("does not let an earlier opening's late read replace a later one's", async () => {
    messages = [{ at: 1, from: "human", text: "first" }];
    const w = await open();
    const reopen = async () => {
      isOpen.value = false;
      await flushPromises();
      isOpen.value = true;
      await flushPromises();
    };
    let release: () => void = () => {};
    roomGate = new Promise((resolve) => (release = resolve));
    messages = [{ at: 2, from: "human", text: "stale" }];
    await reopen();
    roomGate = Promise.resolve();
    messages = [{ at: 3, from: "human", text: "fresh" }];
    await reopen();
    release();
    await flushPromises();
    expect(w.findAll('[data-testid="room-message"]').map((row) => row.text().includes("fresh"))).toEqual([true]);
    w.unmount();
  });

  // The screen outlives a close, so a post can answer after it: nothing is read for a hidden screen.
  it("reads nothing when a post answers after the screen was closed", async () => {
    const w = await open();
    let release: () => void = () => {};
    postGate = new Promise((resolve) => (release = resolve));
    await w.find('[data-testid="room-draft"]').setValue("late");
    await w.find("form").trigger("submit");
    isOpen.value = false;
    await flushPromises();
    const before = reads;
    release();
    await flushPromises();
    expect(reads).toBe(before);
    w.unmount();
  });

  it("shows what was said, and who said it", async () => {
    messages = [
      { at: 1, from: "#1 · claude", text: "I think we should split it" },
      { at: 2, from: "human", text: "agreed" },
    ];
    const rows = (await open()).findAll('[data-testid="room-message"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain("I think we should split it");
    expect(rows[1]?.text()).toContain("human");
  });

  it("lists the rooms that exist", async () => {
    expect((await open()).findAll('[data-testid="room-item"]').map((b) => b.text())).toEqual(["standup", "design-review"]);
  });

  // An unreadable room must not render as an empty one — the same distinction the server started
  // making in #1476, and a person cannot tell the two apart at all without being told.
  it("says it could not read the room rather than showing an empty conversation", async () => {
    readOk = false;
    const w = await open();
    expect(w.find('[data-testid="room-read-error"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Nothing has been said");
  });

  it("says a room is empty when it really is", async () => {
    const w = await open();
    expect(w.find('[data-testid="room-read-error"]').exists()).toBe(false);
    expect(w.text()).toContain("Nothing has been said");
  });

  // The post box is the half of #1456 that makes a room worth having: the agents are typed into by
  // the runner and cannot reach anything, so a person joins from outside, as the CLI does.
  it("posts what a person types, under the name they are using", async () => {
    const w = await open();
    await w.find('[data-testid="room-speaker"]').setValue("isamu");
    await w.find('[data-testid="room-draft"]').setValue("what about the cache?");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(posted).toEqual([{ room: "standup", from: "isamu", text: "what about the cache?" }]);
    expect((w.find('[data-testid="room-draft"]').element as HTMLTextAreaElement).value).toBe("");
  });

  // A post that vanished from the box without reaching the room is the one outcome a person cannot
  // recover from — so the text stays put and it says so.
  it("keeps the message in the box when the post did not land", async () => {
    postOk = false;
    const w = await open();
    await w.find('[data-testid="room-draft"]').setValue("important");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(w.find('[data-testid="room-send-error"]').exists()).toBe(true);
    expect((w.find('[data-testid="room-draft"]').element as HTMLTextAreaElement).value).toBe("important");
  });

  it("will not send an empty message", async () => {
    const w = await open();
    await w.find('[data-testid="room-draft"]').setValue("   ");
    expect(w.find('[data-testid="room-send"]').attributes("disabled")).toBeDefined();
  });

  // Every table mints a room, so a listing nobody can tidy is what makes people stop opening it.
  it("deletes a conversation, once", async () => {
    const confirmed = vi.spyOn(window, "confirm").mockReturnValue(true);
    const w = await open();
    await w.findAll('[data-testid="room-delete"]')[1]?.trigger("click");
    await flushPromises();
    expect(confirmed).toHaveBeenCalled();
    expect(deleted).toEqual(["design-review"]);
  });

  // A table posts a turn every couple of minutes, so the newest line has to arrive on screen —
  // but not by yanking somebody away from the passage they scrolled back to read.
  describe("following the conversation", () => {
    const logEl = (w: Awaited<ReturnType<typeof open>>) => w.find('[data-testid="room-message"]').element.parentElement as HTMLElement;
    // jsdom lays nothing out, so the scroll geometry is stated rather than measured.
    const geometry = (el: HTMLElement, scrollTop: number) => {
      Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
      el.scrollTop = scrollTop;
    };
    // One poll, driven rather than waited for.
    const nextPoll = async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushPromises();
      await flushPromises();
    };

    const arrives = async (scrollTop: number) => {
      vi.useFakeTimers();
      messages = [{ at: 1, from: "#1", text: "one" }];
      const w = await open();
      const el = logEl(w);
      geometry(el, scrollTop);
      messages = [...messages, { at: 2, from: "#2", text: "two" }];
      await nextPoll();
      expect(w.findAll('[data-testid="room-message"]')).toHaveLength(2);
      return el.scrollTop;
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("scrolls to the newest message when the reader is already at the end", async () => {
      expect(await arrives(900)).toBe(1000);
    });

    it("leaves the view alone when the reader has scrolled back", async () => {
      expect(await arrives(0)).toBe(0);
    });
  });

  // The watcher awaits before arming the poll, so two room changes in quick succession leave an
  // older run suspended; it resumes after the newer one armed, overwrites the handle, and the newer
  // timer becomes unreachable — two intervals polling and one that can never be cleared.
  it("arms exactly one poll when the room changes while a read is in flight", async () => {
    vi.useFakeTimers();
    try {
      const w = mount(RoomsOverlay);
      openRoom.value = "design-review";
      await flushPromises();
      await flushPromises();

      reads = 0;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushPromises();
      expect(reads).toBe(1);

      // And the one that exists is the one unmounting can stop.
      w.unmount();
      reads = 0;
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      await flushPromises();
      expect(reads).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const w = await open();
    await w.findAll('[data-testid="room-delete"]')[0]?.trigger("click");
    await flushPromises();
    expect(deleted).toEqual([]);
  });
});
