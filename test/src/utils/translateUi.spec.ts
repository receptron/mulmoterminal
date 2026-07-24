import { describe, it, expect, vi, afterEach } from "vitest";

import { translateUiSentence } from "../../../src/utils/translateUi";

const EN = "Use the button instead.";

function setLocale(tag: string) {
  vi.stubGlobal("navigator", { language: tag });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("translateUiSentence", () => {
  it("returns the English input unchanged for an English locale, without fetching", () => {
    setLocale("en-US");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    return translateUiSentence(EN, "ns").then((out) => {
      expect(out).toBe(EN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("returns the server's translation for a non-English locale", async () => {
    setLocale("ja");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translations: ["ボタンを使ってください。"] }) }));
    expect(await translateUiSentence(EN, "ns")).toBe("ボタンを使ってください。");
  });

  it("falls back to English when the request fails, is not ok, or returns no translation", async () => {
    setLocale("ja");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await translateUiSentence(EN, "ns")).toBe(EN);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await translateUiSentence(EN, "ns")).toBe(EN);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await translateUiSentence(EN, "ns")).toBe(EN);
  });
});
