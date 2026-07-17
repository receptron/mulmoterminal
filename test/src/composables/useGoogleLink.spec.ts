// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useGoogleLink } from "../../../src/composables/../../src/composables/useGoogleLink";

const jsonResponse = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

const LINKED = { linked: true, pending: false, clientSecret: "found", lastError: null };
const PENDING = { linked: false, pending: true, clientSecret: "found", lastError: null };

describe("useGoogleLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(LINKED)),
    );
    const link = useGoogleLink();
    await link.refresh();
    expect(link.status.value).toEqual(LINKED);
    expect(link.error.value).toBe("");
    link.dispose();
  });

  it("defaults a malformed payload to safe values instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ linked: "yes", clientSecret: "weird" })),
    );
    const link = useGoogleLink();
    await link.refresh();
    expect(link.status.value).toEqual({ linked: false, pending: false, clientSecret: "found", lastError: null });
    link.dispose();
  });

  it("surfaces the server's lastError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ...LINKED, lastError: "consent timed out" })),
    );
    const link = useGoogleLink();
    await link.refresh();
    expect(link.error.value).toBe("consent timed out");
    link.dispose();
  });

  it("reports a failed status load without clearing state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false, 500)),
    );
    const link = useGoogleLink();
    await link.refresh();
    expect(link.error.value).toMatch(/Couldn't load/);
    link.dispose();
  });

  describe("polling", () => {
    it("keeps polling while the server reports pending", async () => {
      const fetchMock = vi.fn(async () => jsonResponse(PENDING));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      link.dispose();
    });

    it("stops polling once the flow settles", async () => {
      const fetchMock = vi.fn(async () => jsonResponse(LINKED));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      link.dispose();
    });

    it("stops polling after dispose, so a closed modal can't keep fetching", async () => {
      const fetchMock = vi.fn(async () => jsonResponse(PENDING));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      link.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // `pending` mirrors the server, not our reachability: a blip mid-consent must
    // neither strand the flow nor clear it.
    it("backs off on transient failures but keeps polling", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(PENDING))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(jsonResponse(PENDING));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      await vi.advanceTimersByTimeAsync(2000); // 2nd call fails → backs off to 4s
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000); // not yet
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000); // 4s elapsed → retried
      expect(fetchMock).toHaveBeenCalledTimes(3);
      link.dispose();
    });
  });

  describe("connect", () => {
    it("opens the consent URL and starts polling", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ linked: false, pending: false, clientSecret: "found", lastError: null }))
        .mockResolvedValueOnce(jsonResponse({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }))
        .mockResolvedValue(jsonResponse(PENDING));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      await link.connect();
      expect(open).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1", "_blank", "noopener");
      expect(link.status.value?.pending).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      link.dispose();
    });

    // The flow is live once consent opens, so polling must start even if no status
    // ever loaded (a failed initial refresh leaves `pending` unknown).
    it("polls after connecting even when no status loaded first", async () => {
      vi.stubGlobal("open", vi.fn());
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }))
        .mockResolvedValue(jsonResponse(PENDING));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.connect();
      expect(link.status.value).toBeNull();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      link.dispose();
    });

    it("reports an error and opens nothing when the flow won't start", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({}, false, 500)),
      );
      const link = useGoogleLink();
      await link.connect();
      expect(open).not.toHaveBeenCalled();
      expect(link.error.value).toMatch(/Couldn't start/);
      expect(link.busy.value).toBe(false);
      link.dispose();
    });

    it("opens nothing when the response carries no authUrl", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({})),
      );
      const link = useGoogleLink();
      await link.connect();
      expect(open).not.toHaveBeenCalled();
      expect(link.error.value).toMatch(/Couldn't start/);
      link.dispose();
    });
  });

  describe("unlink", () => {
    it("clears linked on success", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(LINKED))
        .mockResolvedValue(jsonResponse({ linked: false }));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      await link.unlink();
      expect(link.status.value?.linked).toBe(false);
      link.dispose();
    });

    it("keeps the link and reports an error when unlink fails", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(LINKED))
        .mockResolvedValue(jsonResponse({}, false, 500));
      vi.stubGlobal("fetch", fetchMock);
      const link = useGoogleLink();
      await link.refresh();
      await link.unlink();
      expect(link.status.value?.linked).toBe(true);
      expect(link.error.value).toMatch(/Couldn't unlink/);
      link.dispose();
    });
  });
});
