// Launcher shortcut (pinned collection / feed) — browser-safe shape shared by the
// shortcuts store, PinToggle, and the toolbar launcher. The on-disk format
// (`{ shortcuts: Shortcut[] }`) is written/read by the server (server/backends/
// shortcuts.ts) and is the SAME file + format MulmoClaude uses — keep this type in
// sync with mulmoclaude/src/types/shortcuts.ts.

export const SHORTCUT_KINDS = ["collection", "feed"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

export interface Shortcut {
  /** Which route family — drives the launcher's navigation target. */
  kind: ShortcutKind;
  /** The target collection / feed slug. */
  slug: string;
  /** Cached display label (user-named) — refreshed on reconcile. */
  title: string;
  /** Cached material-symbols glyph — refreshed on reconcile. */
  icon: string;
}

/** True when two shortcuts target the same thing (the dedupe key). */
export function sameShortcut(left: Pick<Shortcut, "kind" | "slug">, right: Pick<Shortcut, "kind" | "slug">): boolean {
  return left.kind === right.kind && left.slug === right.slug;
}
