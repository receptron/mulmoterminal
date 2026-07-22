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

const PREFIX_MAX_LENGTH = 60;

// Turn an LLM-supplied document title into exactly ONE path-safe filename segment: lowercase,
// every run of non-[a-z0-9] collapsed to a single "-", no leading/trailing "-", capped, and a
// "document" fallback when nothing survives.
//
// This is the only thing standing between a model-authored title like `../../etc/x` or
// `foo/bar` and a path separator injected into a workspace write. The single-segment property
// is the whole point — a value that keeps a `/` reaches buildDocPath and escapes DOCS_DIR, or
// produces a name isDocPath later rejects so the saved doc never loads.
export function sanitizeDocPrefix(prefix: string): string {
  const cleaned = String(prefix || "document")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // Runs are already collapsed to a single "-" above, so trim one at each end (no
    // quantifier — keeps the regex trivially linear).
    .replace(/^-|-$/g, "")
    .slice(0, PREFIX_MAX_LENGTH);
  return cleaned || "document";
}

// The workspace-relative path a new document is written to: artifacts/documents/YYYY/MM/<prefix>-<rand>.md.
// `now` and `rand` are parameters so the path is assertable; the caller passes the real clock and id.
export function buildDocPath(prefix: string, now: Date, rand: string): string {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${DOCS_DIR}/${yyyy}/${mm}/${sanitizeDocPrefix(prefix)}-${rand}.md`;
}
