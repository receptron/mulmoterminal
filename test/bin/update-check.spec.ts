import { describe, it, expect, vi, afterEach } from "vitest";
import { isNewerVersion, fetchLatestVersion } from "../../bin/../bin/update-check.js";

describe("isNewerVersion", () => {
  const cases: [string, string, boolean][] = [
    ["0.1.3", "0.1.0", true],
    ["0.2.0", "0.1.9", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.10", "0.1.9", true], // numeric, not lexical (the bug a string compare hits)
    ["0.1.3", "0.1.3", false],
    ["0.1.0", "0.1.3", false],
    ["0.9.9", "1.0.0", false],
    ["0.1.4-beta.1", "0.1.3", true], // pre-release suffix ignored on the core
    ["0.1.3", "0.1.3-beta.1", false], // equal core → not newer
  ];
  it.each(cases)("isNewerVersion(%s, %s) === %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

describe("fetchLatestVersion", () => {
  const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));
  afterEach(() => vi.unstubAllGlobals());

  it("returns the version from a 200 response", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: "1.2.3" }) }));
    expect(await fetchLatestVersion()).toBe("1.2.3");
  });

  it("returns null on a non-OK response", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when fetch rejects (offline / timeout)", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when the payload has no version string", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ name: "mulmoterminal" }) }));
    expect(await fetchLatestVersion()).toBeNull();
  });
});
