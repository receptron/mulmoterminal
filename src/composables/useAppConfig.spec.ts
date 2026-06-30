import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppConfig } from "./useAppConfig";

// Echo the posted cwdPresets back as the server would, so presets.value reflects
// each save. useAppConfig's presets ref is per-call (not a singleton), so every
// useAppConfig() in these tests starts from an empty list.
function mockConfigFetch() {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
  }) as unknown as typeof fetch;
}

beforeEach(mockConfigFetch);

describe("useAppConfig — auto preset recording", () => {
  it("recordPreset prepends a new dir with a basename label", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/home/me/alpha");
    expect(presets.value).toEqual([{ label: "alpha", path: "/home/me/alpha" }]);
  });

  it("dedups by path and keeps the existing position (no reshuffle on reuse)", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a/one");
    await recordPreset("/b/two");
    await recordPreset("/a/one"); // already present
    expect(presets.value.map((p) => p.path)).toEqual(["/b/two", "/a/one"]);
  });

  it("has no cap — keeps every distinct dir, newest first", async () => {
    const { presets, recordPreset } = useAppConfig();
    for (const d of ["/a", "/b", "/c", "/d", "/e", "/f"]) await recordPreset(d);
    expect(presets.value).toHaveLength(6);
    expect(presets.value[0].path).toBe("/f");
  });

  it("ignores a null or empty path", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset(null);
    await recordPreset("");
    expect(presets.value).toEqual([]);
  });

  it("removePreset drops the matching path", async () => {
    const { presets, recordPreset, removePreset } = useAppConfig();
    await recordPreset("/a");
    await recordPreset("/b");
    await removePreset("/a");
    expect(presets.value.map((p) => p.path)).toEqual(["/b"]);
  });
});
