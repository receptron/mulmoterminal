// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { splitHitMiss, mergeTranslations, assembleResult, validateRequest, TranslationInputError, mountTranslationRoutes } from "../../../server/backends/../../server/backends/translation.js";

describe("splitHitMiss", () => {
  const dict = { sentences: { Hello: { ja: "こんにちは" }, Bye: { ja: "さようなら" } } };

  it("partitions hits from distinct misses, preserving miss order", () => {
    const { cached, misses } = splitHitMiss(dict, ["Hello", "New", "Other", "New"], "ja");
    expect(cached.get("Hello")).toBe("こんにちは");
    expect(misses).toEqual(["New", "Other"]); // deduped, in first-seen order
  });

  it("treats a different language as a full miss", () => {
    const { cached, misses } = splitHitMiss(dict, ["Hello"], "fr");
    expect(cached.size).toBe(0);
    expect(misses).toEqual(["Hello"]);
  });
});

describe("mergeTranslations", () => {
  it("adds a new language without dropping existing ones", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは" } } };
    const next = mergeTranslations(dict, "fr", new Map([["Hello", "Bonjour"]]));
    expect(next.sentences.Hello).toEqual({ ja: "こんにちは", fr: "Bonjour" });
  });

  it("does not mutate the input dictionary", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは" } } };
    mergeTranslations(dict, "fr", new Map([["Hello", "Bonjour"]]));
    expect(dict.sentences.Hello).toEqual({ ja: "こんにちは" });
  });

  it("safely handles a __proto__ source key (no prototype pollution)", () => {
    const next = mergeTranslations({ sentences: {} }, "ja", new Map([["__proto__", "x"]]));
    expect(Object.hasOwn(next.sentences, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).ja).toBeUndefined();
  });
});

describe("assembleResult", () => {
  it("reassembles input order from cache hits + fresh translations", () => {
    const cached = new Map([["A", "a"]]);
    const fresh = new Map([["B", "b"]]);
    expect(assembleResult(["A", "B", "A"], cached, fresh)).toEqual(["a", "b", "a"]);
  });

  it("throws when a sentence has no translation", () => {
    expect(() => assembleResult(["A"], new Map(), new Map())).toThrow();
  });
});

describe("validateRequest", () => {
  it("accepts a well-formed request", () => {
    const req = validateRequest({ namespace: "ui", targetLanguage: "ja", sentences: ["Hi"] });
    expect(req.namespace).toBe("ui");
  });

  it("rejects a bad namespace / language / empty sentences", () => {
    expect(() => validateRequest({ namespace: "../etc", targetLanguage: "ja", sentences: ["Hi"] })).toThrow(TranslationInputError);
    expect(() => validateRequest({ namespace: "ui", targetLanguage: "japanese", sentences: ["Hi"] })).toThrow(TranslationInputError);
    expect(() => validateRequest({ namespace: "ui", targetLanguage: "ja", sentences: [] })).toThrow(TranslationInputError);
  });
});

describe("POST /api/translation", () => {
  let ws: string;
  let server: Server;
  let base: string;
  let calls: Array<{ targetLanguage: string; sentences: readonly string[] }>;

  // Fake LLM: deterministic, records its calls so we can assert caching skips it.
  const fakeBatch = async (targetLanguage: string, sentences: readonly string[]) => {
    calls.push({ targetLanguage, sentences });
    return sentences.map((s) => `${s}-${targetLanguage}`);
  };

  beforeEach(async () => {
    calls = [];
    ws = mkdtempSync(path.join(tmpdir(), "mt-tr-"));
    const app = express();
    app.use(express.json());
    mountTranslationRoutes(app, { workspace: ws, translateBatch: fakeBatch });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(ws, { recursive: true, force: true });
  });

  const post = (body: unknown) =>
    fetch(`${base}/api/translation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("short-circuits English without invoking the LLM or writing a cache", async () => {
    const res = await post({ namespace: "ui", targetLanguage: "en", sentences: ["Hello", "Bye"] });
    expect(await res.json()).toEqual({ translations: ["Hello", "Bye"] });
    expect(calls).toHaveLength(0);
    expect(existsSync(path.join(ws, "data", "translation", "ui.json"))).toBe(false);
  });

  it("translates misses, persists the shared-schema cache, and serves the next call from it", async () => {
    const first = await post({ namespace: "ui", targetLanguage: "ja", sentences: ["Hello", "Bye"] });
    expect(await first.json()).toEqual({ translations: ["Hello-ja", "Bye-ja"] });
    expect(calls).toHaveLength(1);

    const cacheFile = path.join(ws, "data", "translation", "ui.json");
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual({
      sentences: { Hello: { ja: "Hello-ja" }, Bye: { ja: "Bye-ja" } },
    });

    // Second call is fully cached → LLM not called again, only the new miss is.
    const second = await post({ namespace: "ui", targetLanguage: "ja", sentences: ["Hello", "New"] });
    expect(await second.json()).toEqual({ translations: ["Hello-ja", "New-ja"] });
    expect(calls).toHaveLength(2);
    expect(calls[1].sentences).toEqual(["New"]); // only the miss reached the LLM
  });

  it("400s on invalid input", async () => {
    const res = await post({ namespace: "ui", targetLanguage: "nope", sentences: ["Hi"] });
    expect(res.status).toBe(400);
  });
});
