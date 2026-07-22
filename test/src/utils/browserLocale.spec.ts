import { describe, it, expect, vi, afterEach } from "vitest";

import { browserLocale } from "../../../src/utils/browserLocale";

const withLanguage = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);

afterEach(() => vi.restoreAllMocks());

describe("browserLocale", () => {
  it("returns a bare language tag as-is", () => {
    withLanguage("ja");
    expect(browserLocale()).toBe("ja");
  });

  // The region is dropped on purpose: callers pick a translation bundle with this, and
  // en-GB and en-US want the same one.
  it("drops the region", () => {
    withLanguage("en-GB");
    expect(browserLocale()).toBe("en");
  });

  it("drops a script and region too", () => {
    withLanguage("zh-Hant-TW");
    expect(browserLocale()).toBe("zh");
  });

  // A browser that reports nothing must not produce an empty locale key, which would miss
  // every bundle rather than falling back to English.
  it("falls back to English when the browser reports nothing", () => {
    withLanguage("");
    expect(browserLocale()).toBe("en");
  });
});
