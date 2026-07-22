// What counts as a presentDocument document, for the one place that decides it.
//
// Two sites need this answer and had their own copy: the write guard in markdown.ts
// (loadDoc/saveDoc, where it is the only thing keeping an LLM-authored path inside the
// workspace) and the live-refresh scope matcher in fileChange.ts, whose comment claimed to
// "mirror the host write sites exactly" while omitting the normalization check. A predicate
// that two files define differently while documenting them as identical is a drift waiting
// to matter — a write site that accepts what the refresh site rejects means a saved document
// that never updates on screen.

import path from "node:path";

export const DOCS_DIR = "artifacts/documents";

// Strict: under artifacts/documents, ending in .md, and already in normalized POSIX form.
// The normalization equality is the containment check — `artifacts/documents/../../x.md`
// normalizes to something else and is refused, so a path can never climb out of the
// workspace. It also refuses harmless-but-odd spellings like `artifacts/documents/./x.md`,
// which is intended: there is exactly one way to name a document.
export function isDocPath(rel: string): boolean {
  if (!rel.startsWith(`${DOCS_DIR}/`) || !rel.endsWith(".md")) return false;
  const normalized = path.posix.normalize(rel);
  return normalized === rel && !normalized.includes("..");
}
