import { describe, it, expect, vi, afterEach } from "vitest";

import { fetchJson } from "../../../src/utils/fetchJson";

// Callers branch on `status`: the collection UI treats 404 as "not found" and anything else
// as "skip". A transport failure reports 0 — there was no response to have a status — and
// conflating the two would make an offline browser look like a missing collection.
afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) }));
    expect(await fetchJson<{ a: number }>("/api/x")).toEqual({ ok: true, data: { a: 1 } });
  });

  it("reports the HTTP status on an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchJson("/api/x")).toEqual({ ok: false, error: "HTTP 404", status: 404 });
  });

  // The distinction the callers depend on.
  it("reports status 0 when the request never reached a server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    expect(await fetchJson("/api/x")).toEqual({ ok: false, error: "Failed to fetch", status: 0 });
  });

  it("survives a rejection that is not an Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("boom"));
    expect(await fetchJson("/api/x")).toEqual({ ok: false, error: "boom", status: 0 });
  });

  // A 200 whose body is not JSON must not be reported as success with garbage data.
  it("fails with status 0 when the body will not parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const result = await fetchJson("/api/x");
    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it("passes the request options through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("/api/x", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", { method: "POST" });
  });
});
