// Local voice-input transcription, shared with MulmoClaude via @mulmoclaude/core.
// The reusable core (whisper-server sidecar + GGML model download + ffmpeg→WAV)
// lives in `@mulmoclaude/core/whisper`; this file owns only the host glue:
// capability gating (macOS + the whisper-server / ffmpeg binaries), the three
// REST routes, and a single process-wide service pointed at the shared workspace
// models dir. All transcription happens on this machine; no audio leaves it.
//
//   POST /api/transcribe                  audio dataUrl → { text }
//   GET  /api/transcribe/model            capability + model download status
//   POST /api/transcribe/model/download   start the model download (opt-in)
//
// Model selection / a settings toggle are a follow-up; this first cut always uses
// the default model and treats "binaries present" as the opt-in (clicking the mic
// downloads the model on demand).
import path from "node:path";
import { existsSync } from "node:fs";
import type { Express, Request, Response } from "express";
import { createWhisper, DEFAULT_WHISPER_MODEL, type WhisperLogger, type WhisperModelName } from "@mulmoclaude/core/whisper";

const log: WhisperLogger = {
  info: (message, data) => console.log(`[whisper] ${message}`, data ?? ""),
  warn: (message, data) => console.warn(`[whisper] ${message}`, data ?? ""),
  error: (message, data) => console.error(`[whisper] ${message}`, data ?? ""),
};

// One service instance for the process, pointed at <workspace>/models — the same
// dir MulmoClaude uses, so a model downloaded by either app is shared.
let whisper: ReturnType<typeof createWhisper> | null = null;
function service(): ReturnType<typeof createWhisper> {
  if (!whisper) throw new Error("whisper backend not mounted");
  return whisper;
}

// 10 MB decoded audio is ~60 s of opus; the cap just bounds resource use against a
// bypassed client. The raw data-URL cap (base64 ~+33%) is applied before decoding
// so an oversized payload is rejected without first allocating the decoded buffer.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_DATAURL_CHARS = MAX_AUDIO_BYTES * 3;

// Probe a binary once (memoized) by scanning PATH for an executable of that name —
// no child process. Binaries don't appear mid-session, so caching is safe and keeps
// GET /api/transcribe/model cheap.
const binaryCache = new Map<string, boolean>();
function hasBinary(bin: string): boolean {
  const cached = binaryCache.get(bin);
  if (cached !== undefined) return cached;
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const present = dirs.some((dir) => existsSync(path.join(dir, bin)));
  binaryCache.set(bin, present);
  return present;
}

// whisper.cpp transcription needs macOS (Metal) + the whisper-server binary AND
// ffmpeg on PATH — every transcription shells out to ffmpeg (webm→WAV) before the
// sidecar, so both must be in the gate or the mic shows available and each request
// 500s.
function isVoiceInputCapable(): boolean {
  return process.platform === "darwin" && hasBinary("whisper-server") && hasBinary("ffmpeg");
}

// Model selection is a follow-up; always the default for now.
function selectedModel(): WhisperModelName {
  return DEFAULT_WHISPER_MODEL;
}

interface VoiceInputStatus {
  capable: boolean;
  model: { name: WhisperModelName; state: string; progress?: number; error?: string };
}

function getVoiceInputStatus(): VoiceInputStatus {
  const name = selectedModel();
  return { capable: isVoiceInputCapable(), model: { name, ...service().getModelStatus(name) } };
}

// The mic gates on both: capable + the model downloaded.
function isVoiceInputReady(): boolean {
  return isVoiceInputCapable() && service().isModelReady(selectedModel());
}

// Start downloading the selected model (fire-and-forget; idempotent). Once it lands
// and the feature is usable, pre-warm the sidecar so the first transcription is fast.
function startModelDownload(): void {
  const name = selectedModel();
  service()
    .ensureModelDownloaded(name)
    .then(() => warmupVoiceInput())
    .catch(() => undefined);
}

/** Pre-spawn the sidecar when the model is already on disk, so the first
 *  transcription of the session doesn't pay the model-load cost in-request. */
export function warmupVoiceInput(): void {
  if (!isVoiceInputReady()) return;
  service()
    .warmup(selectedModel())
    .catch(() => undefined);
}

/** Kill the warm sidecar — call on server shutdown so no whisper-server leaks. */
export function stopWhisperSidecar(): void {
  whisper?.shutdown();
}

interface DataUrlParts {
  mimeType: string;
  base64: string;
}

/** Parse a `data:<mime>;base64,<payload>` URL. Returns null for anything else.
 *  Hand-parsed (no regex) to sidestep catastrophic-backtracking concerns. */
function parseDataUrl(dataUrl: string): DataUrlParts | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice("data:".length, comma);
  if (!header.includes(";base64")) return null;
  const mimeType = header.split(";")[0] || "application/octet-stream";
  return { mimeType, base64: dataUrl.slice(comma + 1) };
}

/** Whisper language code or "auto". Keep short codes; anything else falls back to
 *  auto-detection from the audio. */
function normalizeLanguage(language: unknown): string {
  if (typeof language === "string" && language.length > 0 && language.length <= 5) return language;
  return "auto";
}

function approxBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

interface TranscribeBody {
  dataUrl?: string;
  language?: string;
}

async function handleTranscribe(req: Request<object, unknown, TranscribeBody>, res: Response): Promise<void> {
  if (!isVoiceInputReady()) {
    res.status(503).json({ error: "voice input is not available (unsupported platform or model not ready)" });
    return;
  }
  const { dataUrl, language } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl) {
    res.status(400).json({ error: "dataUrl is required" });
    return;
  }
  // Bound the raw payload BEFORE decoding so a giant data URL can't be expanded
  // into memory ahead of the post-decode cap.
  if (dataUrl.length > MAX_DATAURL_CHARS) {
    res.status(413).json({ error: "audio clip exceeds the size limit" });
    return;
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    res.status(400).json({ error: "dataUrl must be a base64 data: URI" });
    return;
  }
  if (approxBytes(parsed.base64) > MAX_AUDIO_BYTES) {
    res.status(413).json({ error: "audio clip exceeds the size limit" });
    return;
  }
  try {
    const { text } = await service().transcribe({
      base64: parsed.base64,
      mimeType: parsed.mimeType,
      language: normalizeLanguage(language),
      model: selectedModel(),
    });
    res.json({ text });
  } catch (err) {
    log.error("transcribe failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "transcription failed" });
  }
}

/** Mount the voice-input routes and pre-warm if the model is already present. */
export function mountWhisperRoutes(app: Express, deps: { workspace: string }): void {
  whisper = createWhisper({ modelsDir: path.join(deps.workspace, "models"), logger: log });

  app.post("/api/transcribe", handleTranscribe);

  app.get("/api/transcribe/model", (_req: Request, res: Response) => {
    res.json(getVoiceInputStatus());
  });

  app.post("/api/transcribe/model/download", (_req: Request, res: Response) => {
    if (!isVoiceInputCapable()) {
      res.status(503).json({ error: "voice input is not supported on this machine" });
      return;
    }
    startModelDownload();
    res.json(getVoiceInputStatus());
  });

  warmupVoiceInput();
}
