// LOCAL integration smoke for the runtime translation service (POST /api/translation).
//
// Unlike scripts/ci-ws-smoke.mjs, this exercises the REAL hidden-chat LLM path
// (server/index.ts → translateViaHiddenChat spawns a real `claude` background
// session), so it needs a working `claude` CLI + auth and is NOT part of CI (CI uses
// a stub claude). Run it by hand against a server you started:
//
//   yarn server                                        # terminal 1 (real claude on PATH)
//   MT_PORT=34567 node scripts/smoke-translation.mjs   # terminal 2
//
// CLAUDE_CWD must be a workspace claude already TRUSTS (the default ~/mulmoclaude is
// fine) — the worker runs there, and claude blocks on its trust dialog in any
// untrusted dir, so a throwaway `mktemp -d` workspace would hang.
//
// Asserts: a non-English target returns same-length, actually-translated strings;
// the on-disk cache is written under <workspace>/data/translation; and a repeat call
// is served from cache (fast). Exits non-zero on any failure.
const port = process.env.MT_PORT ?? "34567";
const base = `http://127.0.0.1:${port}`;
const namespace = `smoke-${Date.now()}`; // fresh namespace so we always hit the LLM first
const sentences = ["Save", "Delete this item", "Welcome, {name}!"];

const fail = (msg) => {
  console.log(`✗ translation: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

async function post(body) {
  const res = await fetch(`${base}/api/translation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// English short-circuits with no LLM call — should be instant and identity.
const en = await post({ namespace, targetLanguage: "en", sentences });
if (en.status !== 200 || JSON.stringify(en.json.translations) !== JSON.stringify(sentences)) {
  fail(`English short-circuit failed: ${JSON.stringify(en.json)}`);
}
ok("English short-circuits to identity (no LLM)");

// Real translation via the hidden chat. Generous wall-clock (cold claude startup).
console.log(`… translating ${sentences.length} strings to Japanese via hidden chat (may take ~30s)…`);
const t0 = Date.now();
const ja = await post({ namespace, targetLanguage: "ja", sentences });
const elapsed = Date.now() - t0;
if (ja.status !== 200) fail(`ja request failed (HTTP ${ja.status}): ${JSON.stringify(ja.json)}`);
const out = ja.json.translations;
if (!Array.isArray(out) || out.length !== sentences.length) {
  fail(`expected ${sentences.length} translations, got ${JSON.stringify(out)}`);
}
if (!out.every((s) => typeof s === "string" && s.length > 0)) fail(`non-string/empty translation: ${JSON.stringify(out)}`);
// At least one should differ from the English source (i.e. it actually translated).
if (!out.some((s, i) => s !== sentences[i])) fail(`output identical to input — did not translate: ${JSON.stringify(out)}`);
// The placeholder must survive.
if (!out[2].includes("{name}")) fail(`placeholder {name} not preserved: ${JSON.stringify(out[2])}`);
ok(`translated in ${(elapsed / 1000).toFixed(1)}s → ${JSON.stringify(out)}`);

// A repeat call must be served from the cache: fast and identical.
const t1 = Date.now();
const ja2 = await post({ namespace, targetLanguage: "ja", sentences });
const cachedElapsed = Date.now() - t1;
if (JSON.stringify(ja2.json.translations) !== JSON.stringify(out)) {
  fail(`cached call differs from first: ${JSON.stringify(ja2.json.translations)}`);
}
if (cachedElapsed > 2000) fail(`cached call took ${cachedElapsed}ms — expected the LLM to be skipped`);
ok(`repeat call served from cache in ${cachedElapsed}ms`);

// Invalid input is a 400.
const bad = await post({ namespace, targetLanguage: "not-a-locale", sentences });
if (bad.status !== 400) fail(`expected 400 for invalid locale, got ${bad.status}`);
ok("invalid input rejected with 400");

console.log("✓ translation smoke passed");
