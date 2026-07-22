// Whether a voice clip may be transcribed, and in what language.
//
// Unreachable from a test where it lived: the route bails with 503 unless the host is macOS
// with whisper-server and ffmpeg on PATH, so CI never got past the first line of the handler
// — while these are the checks that decide whether holding the mic button for fifty seconds
// works or returns a bare 413 the UI cannot explain.
//
// The ORDER is part of the rule. The raw data-URL cap runs before decoding so a giant
// payload is refused without first being expanded into memory; the post-decode cap then
// bounds what actually reaches ffmpeg.

// ~60s of opus. The cap bounds resource use against a client that bypassed the UI.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// base64 is ~+33%, so this is a deliberately loose pre-decode bound.
export const MAX_DATAURL_CHARS = MAX_AUDIO_BYTES * 3;

const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;

export interface AudioParts {
  mimeType: string;
  base64: string;
}

export type AudioAdmission = { ok: true; parts: AudioParts } | { ok: false; status: number; error: string };

/** Parse a `data:<mime>;base64,<payload>` URL. Null for anything else. Hand-parsed (no
 *  regex) to sidestep catastrophic-backtracking concerns on attacker-sized input. */
export function parseDataUrl(dataUrl: string): AudioParts | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice("data:".length, comma);
  if (!header.includes(";base64")) return null;
  const mimeType = header.split(";")[0] || "application/octet-stream";
  return { mimeType, base64: dataUrl.slice(comma + 1) };
}

/** Decoded size, without decoding. */
export function approxBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

export function admitAudioClip(dataUrl: unknown): AudioAdmission {
  if (typeof dataUrl !== "string" || !dataUrl) return { ok: false, status: BAD_REQUEST, error: "dataUrl is required" };
  if (dataUrl.length > MAX_DATAURL_CHARS) return { ok: false, status: PAYLOAD_TOO_LARGE, error: "audio clip exceeds the size limit" };
  const parts = parseDataUrl(dataUrl);
  if (!parts) return { ok: false, status: BAD_REQUEST, error: "dataUrl must be a base64 data: URI" };
  if (approxBytes(parts.base64) > MAX_AUDIO_BYTES) return { ok: false, status: PAYLOAD_TOO_LARGE, error: "audio clip exceeds the size limit" };
  return { ok: true, parts };
}

/** A whisper language code, or "auto" to detect from the audio. Anything that is not a short
 *  code falls back rather than being handed to whisper — but note the length bound also
 *  downgrades legitimate longer tags like `zh-Hant`, which silently costs transcription
 *  quality rather than failing visibly. */
const MAX_LANGUAGE_CODE_LENGTH = 5;

export function normalizeLanguage(language: unknown): string {
  if (typeof language === "string" && language.length > 0 && language.length <= MAX_LANGUAGE_CODE_LENGTH) return language;
  return "auto";
}
