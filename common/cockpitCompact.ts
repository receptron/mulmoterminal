// The one place the `cockpitCompact` setting is defined (#3270): each cockpit-roster row shows its
// header and one line naming the session, instead of the memo / summary / prompt / reply lines.
//
// Its own top-level key rather than a field of `cockpitLines`: an older version keeps a top-level
// key it does not know when it writes config.json, but drops an unknown field inside a known object.

/** OFF unless the config says otherwise: the full row is what the roster has always shown. */
export const COCKPIT_COMPACT_DEFAULT = false;

// The key stays a literal on both sides, for the reason common/showLoadAverage.ts gives.

/** Anything that is not a boolean is "unconfigured". */
export const sanitizeCockpitCompact = (input: unknown): boolean => (typeof input === "boolean" ? input : COCKPIT_COMPACT_DEFAULT);
