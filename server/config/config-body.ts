// Which fields of a POST /api/config body are the wrong SHAPE — the check that decides
// between a 400 and a merge.
//
// Kept pure and separate from the route because the route module reads the user's real
// config file at import time, so the rule could not otherwise be tested without touching
// the developer's home directory.
//
// Why shape is checked before merging at all: the merge treats "present" as "replace", and
// every sanitizer answers a non-array with an empty array. So a body like
// `{"providers": {}}` would not fail — it would silently WIPE the saved providers. The
// guard exists so a malformed field is rejected instead of applied as a deletion.

// Must be an array when present. A partial POST may omit any of them.
export const ARRAY_FIELDS = ["cwdPresets", "prRepos", "launchers", "userMcpServers", "providers"] as const;

// `buttons`/`chips` are nullable (null = unconfigured), so they can't join ARRAY_FIELDS:
// reject any present value that is neither an array nor null instead of letting the
// sanitizer silently coerce it to null.
export const NULLABLE_ARRAY_FIELDS = ["buttons", "chips"] as const;

export function badArrayField(body: Record<string, unknown>): string | null {
  return ARRAY_FIELDS.find((field) => body[field] !== undefined && !Array.isArray(body[field])) ?? null;
}

export function badNullableArrayField(body: Record<string, unknown>): string | null {
  return NULLABLE_ARRAY_FIELDS.find((field) => body[field] !== undefined && body[field] !== null && !Array.isArray(body[field])) ?? null;
}
