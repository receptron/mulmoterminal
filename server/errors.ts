// Error message extracted defensively from an unknown thrown value. Shared rather than
// re-declared because the boot module and the session registry log failures identically.
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
