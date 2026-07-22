// The module keeps its fetched list in module scope so a grid mounting a dozen empty cells
// asks the server once. That state has to be reset between tests, hence the fresh import
// per case rather than a shared top-level one.
import { describe, it, expect, vi, beforeEach } from "vitest";

const READY = { providers: [{ id: "openrouter", label: "OpenRouter", ready: true, tokenEnv: "OPENROUTER_API_KEY", models: [] }], anyReady: true };

const freshModule = async () => {
  vi.resetModules();
  return import("../../../src/composables/useLaunchOptions");
};

const ok = (payload: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => payload });

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLaunchOptions", () => {
  it("fetches the list and exposes it", async () => {
    const fetchMock = ok(READY);
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions } = await freshModule();
    const { launchOptions } = useLaunchOptions();
    await vi.waitFor(() => expect(launchOptions.value.anyReady).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/launch-options", expect.anything());
  });

  // A full grid mounts many empty cells at the same moment; they must not each ask.
  it("asks the server once for many simultaneous callers", async () => {
    const fetchMock = ok(READY);
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions } = await freshModule();
    for (let i = 0; i < 12; i += 1) useLaunchOptions();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("does not re-ask once it has an answer", async () => {
    const fetchMock = ok(READY);
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions } = await freshModule();
    const { launchOptions } = useLaunchOptions();
    await vi.waitFor(() => expect(launchOptions.value.anyReady).toBe(true));
    useLaunchOptions();
    useLaunchOptions();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Codex on PR #587: a failed first attempt used to be remembered as "asked", so the
  // picker stayed hidden for the rest of the page session — even after the server was
  // healthy again. The first mount can easily lose a race with a server still starting up.
  it("tries again on the next mount after a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => READY });
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions } = await freshModule();

    const { launchOptions } = useLaunchOptions();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(launchOptions.value.anyReady).toBe(false);

    // Each poll is another cell mounting — the retry happens on one of them.
    await vi.waitFor(() => {
      useLaunchOptions();
      expect(launchOptions.value.anyReady).toBe(true);
    });
  });

  it("treats a non-2xx response as a failure worth retrying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => READY });
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions } = await freshModule();

    const { launchOptions } = useLaunchOptions();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      useLaunchOptions();
      expect(launchOptions.value.anyReady).toBe(true);
    });
  });

  it("keeps the launch form usable while the list is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { useLaunchOptions } = await freshModule();
    const { launchOptions } = useLaunchOptions();
    await vi.waitFor(() => expect(launchOptions.value).toEqual({ providers: [], anyReady: false }));
  });

  it("re-asks on an explicit reload, even after a success", async () => {
    const fetchMock = ok(READY);
    vi.stubGlobal("fetch", fetchMock);
    const { useLaunchOptions, reloadLaunchOptions } = await freshModule();
    useLaunchOptions();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await reloadLaunchOptions();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
