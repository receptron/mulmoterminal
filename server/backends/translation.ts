// Runtime UI-string translation over `POST /api/translation`. This is
// MulmoTerminal's OWN implementation of the contract MulmoClaude defines, so the
// shared `@mulmoclaude/core/translation/client` works against either host:
//
//   POST /api/translation  { namespace, targetLanguage, sentences } → { translations }
//
// Two things are deliberately identical to MulmoClaude so the apps interoperate:
//   1. The HTTP request/response shape (the client is host-agnostic).
//   2. The on-disk cache schema — `<workspace>/data/translation/<namespace>.json`
//      = `{ sentences: { [source]: { [lang]: translation } } }`. Both apps default
//      to the same workspace, the cache is keyed by source sentence + language, and
//      the English source strings are identical, so whichever app translates a
//      sentence first, the other reuses it. NO schema divergence is allowed here.
//
// What's MulmoTerminal-specific is the LLM step. MulmoTerminal must NEVER use
// `claude -p` / `claude --print` (eliminating print mode is the whole point of the
// app), so the translation is done by MulmoTerminal's own hidden chat mechanism,
// injected as `translateBatch`. Only the HTTP contract + cache format are shared
// with MulmoClaude; the LLM path is ours.
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";

// ── On-disk cache schema (SHARED with MulmoClaude — do not diverge) ───────────

/** `{ sentences: { [sourceSentence]: { [lang]: translation } } }`. */
interface DictionaryFile {
  sentences: Record<string, Record<string, string>>;
}

function emptyDictionary(): DictionaryFile {
  return { sentences: {} };
}

// Cache files live under the user's workspace and may be hand-edited or shared
// with the other app; treat the disk shape as untrusted and fall back to an empty
// dictionary on anything unrecognized, so a `{}` / `{ sentences: null }` file can't
// turn every request for the namespace into a 500.
function isValidDictionary(value: unknown): value is DictionaryFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { sentences } = value as { sentences?: unknown };
  if (typeof sentences !== "object" || sentences === null || Array.isArray(sentences)) return false;
  for (const inner of Object.values(sentences)) {
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return false;
    for (const translated of Object.values(inner as Record<string, unknown>)) {
      if (typeof translated !== "string") return false;
    }
  }
  return true;
}

function dictionaryPath(workspace: string, namespace: string): string {
  return path.join(workspace, "data", "translation", `${namespace}.json`);
}

async function loadDictionary(workspace: string, namespace: string): Promise<DictionaryFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(dictionaryPath(workspace, namespace), "utf8"));
  } catch {
    return emptyDictionary(); // missing / unreadable / malformed → start empty
  }
  return isValidDictionary(raw) ? raw : emptyDictionary();
}

// Atomic write (unique temp + rename) so a concurrent writer — including the other
// app on the shared workspace — can never observe a half-written cache file.
async function saveDictionary(workspace: string, namespace: string, dict: DictionaryFile): Promise<void> {
  const file = dictionaryPath(workspace, namespace);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(dict, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

// ── Pure cache logic (exported for tests) ─────────────────────────────────────

// `obj[userKey] = value` with `userKey === "__proto__"` hits the inherited setter
// on Object.prototype instead of creating an own property — losing the entry and
// polluting the object's shape. `Object.defineProperty` bypasses the setter.
function safeAssign<V>(target: Record<string, V>, key: string, value: V): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export interface SplitResult {
  /** input sentence → cached translation. */
  cached: Map<string, string>;
  /** distinct sentences needing a fresh translation. */
  misses: string[];
}

/** Partition the requested sentences into cache hits and the distinct misses. */
export function splitHitMiss(dict: DictionaryFile, sentences: readonly string[], lang: string): SplitResult {
  const cached = new Map<string, string>();
  const missesSet = new Set<string>();
  for (const sentence of sentences) {
    const hit = dict.sentences[sentence]?.[lang];
    if (hit !== undefined) cached.set(sentence, hit);
    else missesSet.add(sentence);
  }
  return { cached, misses: Array.from(missesSet) };
}

/** Return a new dictionary with `fresh` (source→translation) merged in under `lang`. */
export function mergeTranslations(dict: DictionaryFile, lang: string, fresh: ReadonlyMap<string, string>): DictionaryFile {
  const next: Record<string, Record<string, string>> = {};
  for (const [source, langs] of Object.entries(dict.sentences)) {
    safeAssign(next, source, { ...langs });
  }
  for (const [source, translated] of fresh) {
    const existing = Object.hasOwn(next, source) ? next[source] : {};
    // `lang` is regex-validated upstream so it can't be a dangerous key; the only
    // unsafe site is the user-supplied `source`, handled by safeAssign.
    existing[lang] = translated;
    safeAssign(next, source, existing);
  }
  return { sentences: next };
}

/** Reassemble the caller's input order from the cache hits + fresh translations. */
export function assembleResult(sentences: readonly string[], cached: ReadonlyMap<string, string>, fresh: ReadonlyMap<string, string>): string[] {
  return sentences.map((sentence) => {
    const translated = cached.get(sentence) ?? fresh.get(sentence);
    if (translated === undefined) {
      throw new Error(`[translation] missing translation for ${JSON.stringify(sentence)}`);
    }
    return translated;
  });
}

// ── Request validation (mirrors MulmoClaude's bounds) ─────────────────────────

const NAMESPACE_RE = /^[a-zA-Z0-9_-]+$/;
// Fixed-length alternation, no nested quantifiers — safe from ReDoS. Matches a 2-
// or 5-char BCP-47 short code (e.g. `ja`, `pt-BR`).
// eslint-disable-next-line security/detect-unsafe-regex -- single-pass match against a 2- or 5-char locale code, no backtracking.
const LANGUAGE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

// Bound the request so one call can't blow past the `claude -p <json>` argv limit
// (POSIX E2BIG, ~128 KiB) or balloon cost. UI-string callers stay well inside these.
const MAX_SENTENCES = 256;
const MAX_SENTENCE_CHARS = 1024;
const MAX_TOTAL_CHARS = 32 * 1024;

export class TranslationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationInputError";
  }
}

interface TranslateRequest {
  namespace: string;
  targetLanguage: string;
  sentences: string[];
}

/** Validate + narrow the request body. Throws TranslationInputError on bad input. */
export function validateRequest(body: unknown): TranslateRequest {
  const req = (body ?? {}) as Record<string, unknown>;
  if (typeof req.namespace !== "string" || !NAMESPACE_RE.test(req.namespace)) {
    throw new TranslationInputError(`invalid namespace: ${JSON.stringify(req.namespace)}`);
  }
  if (typeof req.targetLanguage !== "string" || !LANGUAGE_RE.test(req.targetLanguage)) {
    throw new TranslationInputError(`invalid targetLanguage: ${JSON.stringify(req.targetLanguage)}`);
  }
  if (!Array.isArray(req.sentences) || req.sentences.length === 0) {
    throw new TranslationInputError("sentences must be a non-empty array");
  }
  if (req.sentences.length > MAX_SENTENCES) {
    throw new TranslationInputError(`sentences exceeds ${MAX_SENTENCES} entries`);
  }
  let totalChars = 0;
  for (const sentence of req.sentences) {
    if (typeof sentence !== "string" || sentence.length === 0) {
      throw new TranslationInputError("sentences must contain non-empty strings");
    }
    if (sentence.length > MAX_SENTENCE_CHARS) {
      throw new TranslationInputError(`sentence exceeds ${MAX_SENTENCE_CHARS} characters`);
    }
    totalChars += sentence.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw new TranslationInputError(`total sentence length exceeds ${MAX_TOTAL_CHARS} characters`);
    }
  }
  return { namespace: req.namespace, targetLanguage: req.targetLanguage, sentences: req.sentences as string[] };
}

// ── LLM step (injected) ───────────────────────────────────────────────────────

/**
 * Translate the distinct cache MISSES, returning one string per input sentence in
 * the SAME order. This is the only LLM seam, injected by the host so the mechanism
 * stays out of this module. MulmoTerminal wires its OWN hidden interactive chat
 * here (NOT `claude -p` — print mode is banned in MulmoTerminal); tests inject a
 * deterministic fake. The return array length MUST equal `sentences.length`.
 */
export type TranslateBatchFn = (targetLanguage: string, sentences: readonly string[]) => Promise<string[]>;

// ── Orchestration + route ─────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface TranslationDeps {
  workspace: string;
  /** The LLM step — MulmoTerminal's hidden chat in production, a fake in tests. */
  translateBatch: TranslateBatchFn;
}

export function mountTranslationRoutes(app: Express, deps: TranslationDeps): void {
  const llm = deps.translateBatch;

  // Per-namespace serialization. Two concurrent requests on the same namespace
  // would otherwise race the read-merge-write of the shared cache file; chaining
  // makes the second see the first's persisted output.
  const chains = new Map<string, Promise<unknown>>();
  function serialize<T>(namespace: string, runner: () => Promise<T>): Promise<T> {
    const prev = chains.get(namespace) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(runner);
    const tracked = next.catch(() => undefined);
    chains.set(namespace, tracked);
    tracked.then(() => {
      if (chains.get(namespace) === tracked) chains.delete(namespace);
    });
    return next;
  }

  async function runOnce(req: TranslateRequest): Promise<string[]> {
    const dict = await loadDictionary(deps.workspace, req.namespace);
    const { cached, misses } = splitHitMiss(dict, req.sentences, req.targetLanguage);
    if (misses.length === 0) {
      return assembleResult(req.sentences, cached, new Map());
    }
    const translated = await llm(req.targetLanguage, misses);
    if (translated.length !== misses.length) {
      throw new Error(`[translation] LLM returned ${translated.length} translations for ${misses.length} sentences`);
    }
    const fresh = new Map<string, string>();
    misses.forEach((sentence, index) => fresh.set(sentence, translated[index]));
    await saveDictionary(deps.workspace, req.namespace, mergeTranslations(dict, req.targetLanguage, fresh));
    return assembleResult(req.sentences, cached, fresh);
  }

  app.post("/api/translation", async (httpReq: Request, res: Response) => {
    let req: TranslateRequest;
    try {
      req = validateRequest(httpReq.body);
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
      return;
    }
    // English is the source language — no translation, no cache, no LLM.
    if (req.targetLanguage === "en") {
      res.json({ translations: [...req.sentences] });
      return;
    }
    try {
      const translations = await serialize(req.namespace, () => runOnce(req));
      res.json({ translations });
    } catch (err) {
      console.error(`[translation] ${req.namespace}/${req.targetLanguage} failed:`, err);
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
