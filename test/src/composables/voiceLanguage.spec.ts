import { describe, it, expect } from "vitest";
import { VOICE_LANGUAGES, parseVoiceLanguage, resolveVoiceLanguage } from "../../../src/composables/voiceLanguage";

describe("parseVoiceLanguage", () => {
  it("defaults to the browser's language when nothing is stored", () => {
    expect(parseVoiceLanguage(null)).toBe("locale");
  });

  it("reads back an explicit detect choice", () => {
    expect(parseVoiceLanguage("auto")).toBe("auto");
  });

  it("reads back every offered language", () => {
    for (const lang of VOICE_LANGUAGES) expect(parseVoiceLanguage(lang.code)).toBe(lang.code);
  });

  // An unrecognized code must not reach whisper as a language token: it would be accepted by
  // the route's length check and then mistranscribe every clip.
  it("falls back to the default for a code that is not offered", () => {
    expect(parseVoiceLanguage("xx")).toBe("locale");
    expect(parseVoiceLanguage("")).toBe("locale");
  });
});

describe("resolveVoiceLanguage", () => {
  // The default must stay bit-for-bit what it always was: whatever the browser locale maps to
  // is what whisper is told, translation quirk included.
  it("uses the locale's language on the default setting", () => {
    expect(resolveVoiceLanguage("locale", "en")).toBe("en");
    expect(resolveVoiceLanguage("locale", "ja")).toBe("ja");
  });

  it("passes the locale's own fallback through untouched", () => {
    expect(resolveVoiceLanguage("locale", "auto")).toBe("auto");
  });

  it("sends the picked language whatever the browser locale is", () => {
    expect(resolveVoiceLanguage("ja", "en")).toBe("ja");
    expect(resolveVoiceLanguage("en", "ja")).toBe("en");
  });

  it("asks whisper to detect on the auto setting", () => {
    expect(resolveVoiceLanguage("auto", "en")).toBe("auto");
  });
});
