// Bringing the pinned-shortcuts file back in line with what actually exists.
//
// Worth being a tested function rather than a loop inside a queued async: the caller writes
// the result with a REPLACE-ALL persist, to a file shared with MulmoClaude. An over-eager
// prune here does not degrade a view — it deletes the user's pinned favourites in both apps,
// with no undo. So the rule that decides what to drop is the dangerous part, and the
// `drifted` flag matters just as much: it is what keeps a routine index fetch from rewriting
// that file on every visit.
import { type Shortcut, type ShortcutKind } from "../types/shortcuts";

// What the index that just fetched knows about the things of this kind that exist.
export interface LiveEntry {
  slug: string;
  title: string;
  icon: string;
}

export interface Reconciled {
  next: Shortcut[];
  // False when nothing changed — the caller must then not write.
  drifted: boolean;
}

// Only entries of `kind` are judged; the authoritative list says nothing about the others,
// so a collection fetch must never prune a feed shortcut (or vice versa).
export function reconcileShortcuts(current: readonly Shortcut[], kind: ShortcutKind, live: readonly LiveEntry[]): Reconciled {
  const liveBySlug = new Map(live.map((entry) => [entry.slug, entry]));
  let drifted = false;
  const next = current.flatMap((entry) => {
    if (entry.kind !== kind) return [entry];
    const fresh = liveBySlug.get(entry.slug);
    if (!fresh) {
      drifted = true;
      return [];
    }
    if (fresh.title !== entry.title || fresh.icon !== entry.icon) {
      drifted = true;
      return [{ ...entry, title: fresh.title, icon: fresh.icon }];
    }
    return [entry];
  });
  return { next, drifted };
}
