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

beforeEach(() => {
  localStorage.clear();
  mockConfigFetch();
});

describe("useAppConfig — auto preset recording", () => {
  it("recordPreset prepends a new dir with a basename label", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/home/me/alpha");
    expect(presets.value).toEqual([{ label: "alpha", path: "/home/me/alpha" }]);
  });

  it("moves an already-known dir to the front on reuse (most-recently-used)", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a/one");
    await recordPreset("/b/two");
    await recordPreset("/a/one"); // reuse → bumps to front
    expect(presets.value.map((p) => p.path)).toEqual(["/a/one", "/b/two"]);
  });

  it("keeps an existing entry's label when bumping it to the front", async () => {
    const { presets, recordPreset } = useAppConfig();
    presets.value = [
      { label: "two", path: "/b/two" },
      { label: "Custom", path: "/a/one" }, // a manual label from legacy cwdPresets
    ];
    await recordPreset("/a/one");
    expect(presets.value).toEqual([
      { label: "Custom", path: "/a/one" },
      { label: "two", path: "/b/two" },
    ]);
  });

  it("does not re-write when the dir is already at the front", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    await recordPreset("/a"); // already most-recent → no POST
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(before);
    expect(presets.value.map((p) => p.path)).toEqual(["/a"]);
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

  it("imports legacy localStorage recents (recent_dirs_v1) into presets on load, then clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/r/one", "/r/two"]));
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init) return { ok: true, json: async () => ({ cwd: "/w", home: "/h", cwdPresets: [{ label: "kept", path: "/p/kept" }], soundFile: null }) };
      const body = init.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value).toEqual([
      { label: "kept", path: "/p/kept" },
      { label: "one", path: "/r/one" },
      { label: "two", path: "/r/two" },
    ]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("does not duplicate a legacy recent already present, but still clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/p/kept", "/r/new"]));
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init) return { ok: true, json: async () => ({ cwd: "/w", home: "/h", cwdPresets: [{ label: "kept", path: "/p/kept" }], soundFile: null }) };
      const body = init.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value.map((p) => p.path)).toEqual(["/p/kept", "/r/new"]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("serializes concurrent records so neither write clobbers the other (#163 review)", async () => {
    // A slow POST means two un-serialized records would both read the empty list and
    // the second would overwrite the first. Serialization keeps both.
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, recordPreset } = useAppConfig();
    await Promise.all([recordPreset("/a"), recordPreset("/b")]);
    expect(presets.value.map((p) => p.path).sort()).toEqual(["/a", "/b"]);
  });
});
