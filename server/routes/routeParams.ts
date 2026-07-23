// Two tiny query-param decisions shared by the terminal ws/session/dir routes, pulled out of
// the handlers so the parse rules live in one place (they were copied verbatim across three
// files, which is how they drift).

// A non-negative integer index from a query param, or NaN for anything else — empty string,
// "-1", "1.5", "1e2", or a missing param. The anchored /^\d+$/ is deliberate: downstream
// resolveScript / canStartLauncher treat NaN as "no such index" and refuse, so a sloppy value
// must not slip through as some other number.
export function parseIndexParam(raw: string | null): number {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
}

// The agent a request selects, normalized. Only an exact "codex" chooses codex; everything
// else — including "CODEX", "", null, an array, or a missing param — falls back to claude, the
// default backend. Case-sensitive on purpose: the query value comes straight from a URL, and a
// mis-cased "CODEX" starting Claude is safer than guessing the user meant codex.
export function normalizeAgent(raw: unknown): "codex" | "claude" {
  return raw === "codex" ? "codex" : "claude";
}
