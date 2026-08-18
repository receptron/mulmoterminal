// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapConcurrent } from "../../../server/infra/mapConcurrent.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("mapConcurrent", () => {
  it("keeps input order even when later items finish first", async () => {
    const delays = [30, 20, 10, 0];
    const out = await mapConcurrent(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:20", "2:10", "3:0"]);
  });

  it("passes the index alongside the item", async () => {
    expect(await mapConcurrent(["a", "b"], 2, async (item, index) => `${index}${item}`)).toEqual(["0a", "1b"]);
  });

  it("never runs more than `limit` at once", async () => {
    let running = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        running -= 1;
      },
    );
    expect(peak).toBe(3);
  });

  it("still runs everything when the limit exceeds the input length", async () => {
    expect(await mapConcurrent([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("returns an empty array for empty input, and spawns no worker", async () => {
    let calls = 0;
    expect(
      await mapConcurrent([], 8, async () => {
        calls += 1;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  // A limit of 0 or a negative one is a caller bug, but stalling forever is the worst possible
  // answer to it — the listing would hang rather than fail.
  it.each([0, -1])("still makes progress with a limit of %i", async (limit) => {
    expect(await mapConcurrent([1, 2, 3], limit, async (n) => n + 1)).toEqual([2, 3, 4]);
  });

  it("rejects when the mapper throws, rather than resolving with a hole", async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("preserves undefined results without treating them as gaps", async () => {
    expect(await mapConcurrent([1, 2, 3], 2, async (n) => (n === 2 ? undefined : n))).toEqual([1, undefined, 3]);
  });
});
