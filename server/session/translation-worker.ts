// The hidden translation worker: /api/translation asks for a batch of strings in another
// language, and this drives a HEADLESS claude session to produce them. Split from index.ts
// (#548 step 3e) — it sat interleaved with the WebSocket handlers, which cannot come out
// until it does.
//
// The worker reports its answer out-of-band, by calling the worker-only submitTranslation
// GUI tool (POST /api/translation/submit). That request lands on a different code path
// than the one waiting for it, so the in-flight promises live here and both sides settle
// them through submitTranslation / failPendingTranslation rather than sharing the map.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { messageOf } from "../errors.js";
import { CLAUDE_CWD } from "../config/env.js";
import { activity, hiddenSessions, knownSessions, lastPrompts, translationWorkerIds } from "./registry.js";
import { projectSessionsDir } from "./project-dir.js";
import { buildTranslationPrompt, isValidTranslationResult } from "./translation-prompt.js";

export interface TranslationWorkerDeps {
  /** Tear down the worker's pty and session bookkeeping. */
  reap: (id: string) => void;
  /** Start a headless claude session (no socket, no viewer) seeded with `prompt`. */
  spawnHiddenChat: (sessionId: string, prompt: string) => void;
}

// In-flight worker requests. `resolve` comes from the worker's own submitTranslation call;
// `reject` from the Stop hook when a worker ends its turn WITHOUT submitting, so a
// misbehaved turn fails fast instead of waiting out the full timeout.
const pendingTranslations = new Map<string, { resolve: (translations: string[]) => void; reject: (err: Error) => void }>();

/** Hand a worker's answer to the request waiting for it. False when no request is
 *  in flight for that id — already settled, timed out, or not a worker at all. */
export function submitTranslation(sessionId: string, translations: unknown): boolean {
  const pending = pendingTranslations.get(sessionId);
  if (!pending) return false;
  pending.resolve(Array.isArray(translations) ? translations : []);
  return true;
}

/** Fail an in-flight worker. A no-op once it has already submitted. */
export function failPendingTranslation(sessionId: string, reason: string): void {
  pendingTranslations.get(sessionId)?.reject(new Error(reason));
}

export function createTranslationWorker(deps: TranslationWorkerDeps) {
  // How long to wait for a hidden translation worker to call submitTranslation before
  // giving up (cold claude startup + one short turn). Generous; the result is cached.
  const TRANSLATION_TIMEOUT_MS = 120_000;

  // Tear down a finished/failed translation worker: kill any lingering pty and drop its
  // bookkeeping + transcript so the activity maps and the workspace don't accumulate
  // throwaway translation sessions.
  function cleanupTranslationWorker(sessionId: string): void {
    deps.reap(sessionId); // idempotent — already reaped if Stop fired
    activity.delete(sessionId);
    hiddenSessions.delete(sessionId);
    translationWorkerIds.delete(sessionId);
    lastPrompts.delete(sessionId);
    pendingTranslations.delete(sessionId);
    fs.rm(path.join(projectSessionsDir(CLAUDE_CWD), `${sessionId}.jsonl`), { force: true }).catch(() => {});
  }

  // Most a worker request retries before failing. The model occasionally answers in
  // text instead of calling submitTranslation (caught fast by the Stop hook); a fresh
  // worker almost always succeeds. Misses are cached, so retries are rare in practice.
  const TRANSLATION_MAX_ATTEMPTS = 3;

  // Run ONE hidden translation worker: spawn it, wait for it to call submitTranslation
  // (or fail via the Stop hook / timeout), validate, and tear it down.
  async function runTranslationWorkerOnce(prompt: string, expected: number): Promise<string[]> {
    const sessionId = randomUUID();
    hiddenSessions.add(sessionId);
    translationWorkerIds.add(sessionId);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const submitted = new Promise<string[]>((resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`[translation] hidden chat timed out after ${TRANSLATION_TIMEOUT_MS}ms`)), TRANSLATION_TIMEOUT_MS);
      pendingTranslations.set(sessionId, { resolve, reject });
    });

    try {
      // ws=null → headless; the worker buffers output nobody reads. Default cwd =
      // CLAUDE_CWD (trusted). submitTranslation (or the Stop hook) settles `submitted`.
      deps.spawnHiddenChat(sessionId, prompt);
      // The spawn registers a pending session + emits a "created" event; drop the
      // pending entry now so this internal worker never surfaces as a sidebar row (the
      // /api/sessions filter on translationWorkerIds covers its on-disk transcript).
      knownSessions.delete(sessionId);
      const translations: unknown = await submitted;
      if (!isValidTranslationResult(translations, expected)) {
        const got = Array.isArray(translations) ? `${translations.length} strings` : "a non-array";
        throw new Error(`[translation] submitTranslation returned ${got} for ${expected} inputs`);
      }
      return translations;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      cleanupTranslationWorker(sessionId);
    }
  }

  // The injected LLM step for /api/translation. Drives MulmoTerminal's EXISTING hidden
  // background chat — explicitly NOT `claude -p`, which is banned in
  // MulmoTerminal. It seeds a headless worker that translates the strings and reports
  // them by calling the worker-only `submitTranslation` GUI tool (POST
  // /api/translation/submit). Retries a fresh worker if one answers without submitting.
  async function translateViaHiddenChat(targetLanguage: string, sentences: readonly string[]): Promise<string[]> {
    const expected = sentences.length;
    const prompt = buildTranslationPrompt(targetLanguage, sentences);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= TRANSLATION_MAX_ATTEMPTS; attempt++) {
      try {
        return await runTranslationWorkerOnce(prompt, expected);
      } catch (err) {
        lastErr = err;
        console.warn(`[translation] attempt ${attempt}/${TRANSLATION_MAX_ATTEMPTS} failed: ${messageOf(err)}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("[translation] hidden chat failed");
  }
  return { translateViaHiddenChat };
}
