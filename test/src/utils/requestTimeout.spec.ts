import { describe, it, expect, afterEach } from "vitest";

import { isRequestTimeout, requestTimeoutError, setRequestTimeoutText } from "../../../src/utils/requestTimeout";
import { i18n } from "../../../src/i18n";
import { UI_LOCALES } from "../../../src/composables/uiLanguage";
import { DEFAULT_REQUEST_TIMEOUT_MS, SLOW_COMMAND_TIMEOUT_MS } from "../../../src/utils/fetchWithTimeout";

describe("requestTimeoutError", () => {
  it("says it was a timeout, how long it waited, and what to do", () => {
    const err = requestTimeoutError(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toContain("did not answer within 8 seconds");
    expect(err.message).toContain("restart MulmoTerminal");
    expect(err.message).not.toContain("aborted");
  });

  it.each([
    [SLOW_COMMAND_TIMEOUT_MS, "60 seconds"],
    [1_499, "1 seconds"],
    [2_500, "3 seconds"],
    [0, "1 seconds"],
    [1, "1 seconds"],
  ])("states %pms as %s", (timeout_ms, expected) => {
    expect(requestTimeoutError(timeout_ms).message).toContain(`within ${expected}`);
  });
});

describe("isRequestTimeout", () => {
  it("recognises its own error", () => {
    expect(isRequestTimeout(requestTimeoutError(DEFAULT_REQUEST_TIMEOUT_MS))).toBe(true);
  });

  it("recognises the platform's timeout too, which carries the same name", () => {
    expect(isRequestTimeout(new DOMException("x", "TimeoutError"))).toBe(true);
  });

  // A caller's own cancellation is not a timeout, and must not be reported as one.
  it.each([
    new DOMException("signal is aborted without reason", "AbortError"),
    new TypeError("Failed to fetch"),
    new Error("TimeoutError"),
    { name: "TimeoutError", message: "x" },
    "TimeoutError",
    null,
    undefined,
    0,
  ])("rejects %p", (value) => {
    expect(isRequestTimeout(value)).toBe(false);
  });
});

describe("requestTimeoutError in the UI language", () => {
  afterEach(() => {
    i18n.global.locale.value = "en";
  });

  // The collection view prefixes this with its own translated "Failed to load"; an English sentence
  // after a Japanese one is the mixed line this wording exists to avoid.
  it.each(UI_LOCALES.map((locale) => locale.code))("states the seconds in %s", (code) => {
    i18n.global.locale.value = code;
    const message = requestTimeoutError(DEFAULT_REQUEST_TIMEOUT_MS).message;
    expect(message).toContain("8");
    expect(message).not.toContain("{seconds}");
    expect(message).toContain("MulmoTerminal");
  });

  it("follows a locale change made after the app booted", () => {
    i18n.global.locale.value = "ja";
    expect(requestTimeoutError(DEFAULT_REQUEST_TIMEOUT_MS).message).toContain("8 秒以内に応答しませんでした");
  });

  it("uses whatever text was installed", () => {
    setRequestTimeoutText((seconds) => `waited ${seconds}`);
    try {
      expect(requestTimeoutError(SLOW_COMMAND_TIMEOUT_MS).message).toBe("waited 60");
    } finally {
      setRequestTimeoutText((seconds) => i18n.global.t("requestTimeout.message", { seconds }));
    }
  });
});
