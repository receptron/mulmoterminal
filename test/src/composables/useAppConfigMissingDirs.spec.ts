// The missing-directory check (#3414) around the config read's background retry: the check must
// neither cost the retry its list nor be lost when only the retry succeeds.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAppConfig } from "../../../src/composables/useAppConfig";

vi.mock("../../../src/composables/lateTerminalWidthTable", () => ({ adoptLateTerminalWidthTable: vi.fn(async () => undefined) }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useAppConfig — missing-directory check and the config retry", () => {
  // #3414: a failed missing-directory check wrote nothing, so it must not make the config read's
  // retry discard the list it brings back. The check runs when the launch panel opens — here, while
  // the retried read is in flight, which is the timing where a bump would discard that read.
  it("adopts the retried config when a missing-directory check fails while the retry is in flight", async () => {
    const gets: string[] = [];
    const after = (delay_ms: number) => new Promise((resolve) => setTimeout(resolve, delay_ms));
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url) === "/api/config/cwd-presets/prune-missing") throw new Error("ECONNREFUSED");
      if (String(url) !== "/api/config") return { ok: true, json: async () => ({}) };
      gets.push(String(url));
      if (gets.length === 1) throw new Error("ECONNREFUSED");
      await after(5_000);
      return { ok: true, json: async () => ({ cwdPresets: [{ label: "proj", path: "/p" }] }) };
    }) as unknown as typeof fetch;
    const { loadConfig, pruneMissingPresets, presets } = useAppConfig();

    await loadConfig();
    await vi.advanceTimersByTimeAsync(2_000); // the retry has started and is waiting on its answer
    expect(gets).toHaveLength(2);
    await pruneMissingPresets();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(presets.value).toEqual([{ label: "proj", path: "/p" }]);
  });

  // #3414: a first read lost to a restart must not cost the missing-directory check — it runs once
  // the background retry is adopted.
  it("runs the missing-directory check after a background retry recovers the config", async () => {
    const urls: string[] = [];
    let getCount = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url) === "/api/config/cwd-presets/prune-missing")
        return { ok: true, json: async () => ({ cwdPresets: [{ label: "kept", path: "/k" }], unreachable: [] }) };
      if (String(url) !== "/api/config") return { ok: true, json: async () => ({}) };
      getCount++;
      if (getCount === 1) throw new Error("ECONNREFUSED");
      return {
        ok: true,
        json: async () => ({
          cwdPresets: [
            { label: "kept", path: "/k" },
            { label: "deleted", path: "/d" },
          ],
        }),
      };
    }) as unknown as typeof fetch;
    const { loadConfigThenPruneMissing, presets } = useAppConfig();

    await loadConfigThenPruneMissing();
    expect(urls).not.toContain("/api/config/cwd-presets/prune-missing"); // nothing adopted yet
    await vi.advanceTimersByTimeAsync(1_500);

    expect(urls.filter((url) => url === "/api/config/cwd-presets/prune-missing")).toHaveLength(1);
    expect(presets.value).toEqual([{ label: "kept", path: "/k" }]);
  });
});
