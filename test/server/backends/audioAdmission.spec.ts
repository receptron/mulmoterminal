// @vitest-environment node
import { describe, it, expect } from "vitest";

import { admitAudioClip, approxBytes, MAX_AUDIO_BYTES, MAX_DATAURL_CHARS, normalizeLanguage, parseDataUrl } from "../../../server/backends/audioAdmission.js";

const dataUrl = (base64: string, header = "audio/webm;base64") => `data:${header},${base64}`;

describe("admitAudioClip", () => {
  it("admits a well-formed clip and hands back its parts", () => {
    expect(admitAudioClip(dataUrl("AAAA"))).toEqual({ ok: true, parts: { mimeType: "audio/webm", base64: "AAAA" } });
  });

  it.each([[undefined], [null], [""], [42], [{}]])("refuses %j with 400", (value) => {
    expect(admitAudioClip(value)).toEqual({ ok: false, status: 400, error: "dataUrl is required" });
  });

  // Order matters: this bound exists so a giant payload is refused WITHOUT first being
  // expanded into memory, so it has to fire BEFORE the parse. A huge string that is not a
  // data URL at all is the case only this check can catch — without it the parse would
  // answer 400 instead, after the whole payload had already been walked.
  it("refuses an oversized payload on length, before deciding whether it parses", () => {
    expect(admitAudioClip("x".repeat(MAX_DATAURL_CHARS + 1))).toEqual({ ok: false, status: 413, error: "audio clip exceeds the size limit" });
  });

  it("refuses an oversized well-formed payload too", () => {
    expect(admitAudioClip(`data:audio/webm;base64,${"A".repeat(MAX_DATAURL_CHARS)}`)).toMatchObject({ ok: false, status: 413 });
  });

  // A payload under the raw bound can still decode to more than the real cap.
  it("refuses a clip whose decoded size is over the cap", () => {
    const base64Length = Math.ceil(((MAX_AUDIO_BYTES + 1024) * 4) / 3);
    expect(admitAudioClip(dataUrl("A".repeat(base64Length)))).toMatchObject({ ok: false, status: 413 });
  });

  it("admits a clip right at the decoded cap", () => {
    const base64Length = Math.floor((MAX_AUDIO_BYTES * 4) / 3);
    expect(admitAudioClip(dataUrl("A".repeat(base64Length))).ok).toBe(true);
  });

  it.each([["notadataurl"], ["data:audio/webm"], ["data:audio/webm,AAAA"], ["http://example.com/a.webm"]])("refuses the malformed URL %j with 400", (value) => {
    expect(admitAudioClip(value)).toEqual({ ok: false, status: 400, error: "dataUrl must be a base64 data: URI" });
  });
});

describe("parseDataUrl", () => {
  it("keeps the mime type ahead of the parameters", () => {
    expect(parseDataUrl("data:audio/ogg;codecs=opus;base64,AA")?.mimeType).toBe("audio/ogg");
  });

  // What ffmpeg is handed when the client sent no mime type at all.
  it("falls back to octet-stream for a headerless URL", () => {
    expect(parseDataUrl("data:;base64,AA")?.mimeType).toBe("application/octet-stream");
  });

  it("returns everything after the comma as the payload", () => {
    expect(parseDataUrl("data:audio/webm;base64,AA,BB")?.base64).toBe("AA,BB");
  });
});

describe("approxBytes", () => {
  it("estimates the decoded size without decoding", () => {
    expect(approxBytes("AAAA")).toBe(3);
    expect(approxBytes("")).toBe(0);
  });
});

describe("normalizeLanguage", () => {
  it.each([["ja"], ["en"], ["zh"]])("keeps the short code %s", (code) => {
    expect(normalizeLanguage(code)).toBe(code);
  });

  it.each([[undefined], [null], [""], [42], [{}]])("falls back to auto for %j", (value) => {
    expect(normalizeLanguage(value)).toBe("auto");
  });

  // Recorded because it is a real cost, not because it is right: a legitimate tag longer
  // than five characters is silently downgraded to auto-detection, which shows up as worse
  // transcription rather than as an error.
  it("downgrades a longer legitimate tag such as zh-Hant to auto", () => {
    expect(normalizeLanguage("zh-Hant")).toBe("auto");
    expect(normalizeLanguage("en-US")).toBe("en-US");
  });
});
