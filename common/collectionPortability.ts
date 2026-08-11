// "Would this collection survive a clone?" — the wire shape, shared because BOTH sides decide
// from it: the server produces the report (server/backends/collectionSelfContainment.ts) and the
// Collections pane renders it, colouring by severity and blocking on `portable`.
//
// In `common/` rather than mirrored, for the reason the layout rule gives: a second copy of a
// union is how a writer and a reader drift while both keep compiling. The RULES stay server-side
// — they read the filesystem and shell out to git — and only their result crosses.
import { isRecord } from "./isRecord.js";
import { isUnknownArray } from "./isUnknownArray.js";

/** Why a collection would not survive a clone. Stable strings — a client branches on these, and
 *  the prose is free to be rewritten without breaking it. */
export type SelfContainmentCode =
  /** The skill lives in `~/.claude/skills`, i.e. on this machine and not in the repo. */
  | "user-scope"
  /** Records are one SQLite file: git cannot merge it. */
  | "sqlite-store"
  /** Records are rows of a CSV read through DuckDB — a runtime the clone must also have. */
  | "csv-runtime"
  /** Records are Firestore documents: shared with the clone, but only if it has credentials. */
  | "firestore-store"
  /** Something the records need is git-ignored: the schema travels, they do not. */
  | "data-ignored"
  /** No `primaryKey`, so ids are 4 random bytes and two machines can mint the same one. */
  | "no-primary-key"
  /** The project is not a git repo, so there is nothing to clone and most checks do not apply. */
  | "not-a-repo";

/** `blocker` stops the clone working; `warning` costs something on the other machine; `info` is
 *  context. Only a blocker makes `portable` false. */
export type SelfContainmentSeverity = "blocker" | "warning" | "info";

export interface SelfContainmentFinding {
  /** One of `SelfContainmentCode` in practice, typed as a plain string on the WIRE on purpose: a
   *  newer server may report a code this build has never heard of, and narrowing here would drop
   *  a real finding behind a version skew. Nothing branches on it — the pane renders `message`
   *  and colours by `severity` — so widening costs nothing. A spec pins that everything the
   *  server produces IS in the union. */
  code: string;
  severity: SelfContainmentSeverity;
  /** What breaks on the other machine, in the terms the person will see it. */
  message: string;
}

export interface SelfContainmentReport {
  slug: string;
  /** True when nothing BLOCKS the clone. Warnings can still be present. */
  portable: boolean;
  findings: SelfContainmentFinding[];
}

/** The severity IS narrowed, unlike the code: it decides how the row is rendered AND whether the
 *  finding is a blocker, so an unrecognised one cannot be shown honestly. A predicate rather than
 *  a list membership test, so the narrowing is the type system's rather than an assertion's. */
export function isSelfContainmentSeverity(value: unknown): value is SelfContainmentSeverity {
  return value === "blocker" || value === "warning" || value === "info";
}

function asFinding(value: unknown): SelfContainmentFinding | null {
  if (!isRecord(value)) return null;
  const { code, severity, message } = value;
  if (typeof code !== "string" || typeof message !== "string") return null;
  if (!isSelfContainmentSeverity(severity)) return null;
  return { code, severity, message };
}

/** Narrow a fetched body to the report, or null when it is not one. The body arrives as
 *  `unknown` — a truncated response, an error page, an older server — so every level is checked
 *  rather than trusted. */
export function asSelfContainmentReport(body: unknown): SelfContainmentReport | null {
  if (!isRecord(body)) return null;
  const { slug, portable, findings } = body;
  if (typeof slug !== "string" || typeof portable !== "boolean" || !isUnknownArray(findings)) return null;
  const parsed: SelfContainmentFinding[] = [];
  for (const entry of findings) {
    const finding = asFinding(entry);
    // ONE UNREADABLE FINDING REJECTS THE WHOLE REPORT. Skipping it would be the worse failure:
    // if the dropped finding was the only blocker, the caller is handed `findings: []` and tells
    // the user "nothing to fix — it travels" about a collection that does not. A report we cannot
    // fully read is not a clean bill of health, and "could not run the check" is the honest
    // answer — visible and actionable, where a false all-clear is neither.
    if (!finding) return null;
    parsed.push(finding);
  }
  return { slug, portable, findings: parsed };
}
