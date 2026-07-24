import { browserLocale } from "./browserLocale";

const REQUEST_TIMEOUT_MS = 8000;

// Localize one English host string via the same runtime-translation route the
// collection UX uses (the mulmoterminal host ships no static i18n). Returns the
// English input unchanged for an English locale, and on any failure — so a caller
// can assign the result unconditionally. Translated strings are server-cached, so
// the first call per sentence is the only slow one.
export async function translateUiSentence(english: string, namespace: string): Promise<string> {
  const locale = browserLocale();
  if (locale === "en") return english;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/translation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace, targetLanguage: locale, sentences: [english] }),
      signal: controller.signal,
    });
    if (!res.ok) return english;
    const data = (await res.json()) as { translations?: string[] };
    return typeof data.translations?.[0] === "string" ? data.translations[0] : english;
  } catch {
    return english;
  } finally {
    clearTimeout(timer);
  }
}
