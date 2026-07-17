import { describe, it, expect, afterEach, vi } from "vitest";
import { useCost } from "../../../src/composables/useCost";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const stubFetch = (impl: (url: string) => { ok: boolean; json: () => Promise<unknown> }) => {
  globalThis.fetch = vi.fn((url: unknown) => Promise.resolve(impl(String(url)))) as unknown as typeof fetch;
};

describe("useCost", () => {
  it("loads and parses a cost payload", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ session: 0.42, today: 1.5, month: 12.3, currency: "USD", unpricedTurns: 2, sessionUnpricedTurns: 1 }) }));
    const { cost, error, loading, load } = useCost();
    await load("/proj", "11111111-2222-3333-4444-555555555555");
    expect(error.value).toBe(false);
    expect(loading.value).toBe(false);
    expect(cost.value).toEqual({ session: 0.42, today: 1.5, month: 12.3, currency: "USD", unpricedTurns: 2, sessionUnpricedTurns: 1 });
  });

  it("passes cwd and session as query params", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return { ok: true, json: async () => ({ today: 0, month: 0, currency: "USD", unpricedTurns: 0 }) };
    });
    const { load } = useCost();
    await load("/my/proj", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(seen[0]).toContain("cwd=%2Fmy%2Fproj");
    expect(seen[0]).toContain("session=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("defaults missing numeric fields to 0 and session to undefined", async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ currency: "USD" }) }));
    const { cost, load } = useCost();
    await load("/proj");
    expect(cost.value).toEqual({ session: undefined, today: 0, month: 0, currency: "USD", unpricedTurns: 0, sessionUnpricedTurns: 0 });
  });

  it("flags an error on a non-ok response", async () => {
    stubFetch(() => ({ ok: false, json: async () => ({}) }));
    const { cost, error, load } = useCost();
    await load("/proj");
    expect(error.value).toBe(true);
    expect(cost.value).toBeNull();
  });

  it("flags an error when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
    const { cost, error, load } = useCost();
    await load("/proj");
    expect(error.value).toBe(true);
    expect(cost.value).toBeNull();
  });
});
