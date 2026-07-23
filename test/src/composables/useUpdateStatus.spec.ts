import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, type ComputedRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useUpdateStatus } from "../../../src/composables/useUpdateStatus";
import type { UpdateBadge } from "../../../src/composables/updateNotice";

afterEach(() => vi.unstubAllGlobals());

function mountStatus() {
  let badge!: ComputedRef<UpdateBadge | null>;
  const w = mount(
    defineComponent({
      setup() {
        badge = useUpdateStatus().badge;
        return () => h("div");
      },
    }),
  );
  return { w, badge: () => badge.value };
}

const GIT_NOTICE = "Update available: a1b2c3d → origin  ·  run: git pull";

describe("useUpdateStatus", () => {
  it("exposes a badge when the server reports a notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ notice: GIT_NOTICE }) })),
    );
    const { badge } = mountStatus();
    await flushPromises();
    expect(badge()?.command).toBe("git pull");
  });

  it("has no badge when the server reports none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ notice: null }) })),
    );
    const { badge } = mountStatus();
    await flushPromises();
    expect(badge()).toBeNull();
  });

  // The file may not be readable / the request may fail — the badge just stays hidden.
  it("stays hidden when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { badge } = mountStatus();
    await flushPromises();
    expect(badge()).toBeNull();
  });

  // The server's check reaches the network (ls-remote can take seconds), so the first read is
  // null; a later poll must pick the notice up rather than give up on the first empty answer.
  it("shows the badge when the notice arrives on a later poll", async () => {
    vi.useFakeTimers();
    try {
      let served: string | null = null; // the server check hasn't finished yet
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ notice: served }) })),
      );
      const { badge } = mountStatus();
      await vi.waitFor(() => expect(badge).not.toBeUndefined());
      expect(badge()).toBeNull();

      served = GIT_NOTICE; // the check finished behind
      await vi.advanceTimersByTimeAsync(3000);
      expect(badge()?.command).toBe("git pull");
    } finally {
      vi.useRealTimers();
    }
  });

  // A server that is genuinely up to date answers null every time — polling must give up, not
  // hammer the endpoint forever.
  it("stops polling after a bounded number of empty reads", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notice: null }) }));
      vi.stubGlobal("fetch", fetchMock);
      mountStatus();
      await vi.advanceTimersByTimeAsync(3000 * 10);
      expect(fetchMock.mock.calls).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
