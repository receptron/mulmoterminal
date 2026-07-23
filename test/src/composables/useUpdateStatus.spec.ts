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

describe("useUpdateStatus", () => {
  it("exposes a badge when the server reports a notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ notice: "Update available: a1b2c3d → origin  ·  run: git pull" }) })),
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

  // The codex-flagged race: the first read returns a previous run's notice, but this run is
  // clean once the launcher overwrites the file. The delayed re-read must clear the stale
  // badge rather than skip because a (stale) value was already present.
  it("clears a stale badge on the delayed re-read", async () => {
    vi.useFakeTimers();
    try {
      let current = "Update available: a1b2c3d → origin  ·  run: git pull";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ notice: current }) })),
      );
      const { badge } = mountStatus();
      await vi.waitFor(() => expect(badge()?.command).toBe("git pull"));

      current = null as unknown as string; // launcher overwrote the file: this run is clean
      await vi.advanceTimersByTimeAsync(5000);
      expect(badge()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
});
