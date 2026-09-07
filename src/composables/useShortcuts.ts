// Client store for shared launcher favorites (pinned collections / feeds).
// Singleton module state shared across every consumer — the toolbar launcher
// renders them, the index/view PinToggle toggles them, the indexes reconcile stale
// labels — so they all see one list. Ported from MulmoClaude's useShortcuts, over
// GET/PUT /api/shortcuts via the shared fetchJson helper.
//
// Persistence is server-side (`config/shortcuts.json`, shared with MulmoClaude); the
// client owns the full array and replaces it wholesale. Mutations are optimistic
// with rollback, and serialized so overlapping replace-all PUTs can't reorder.
import { computed, ref, type ComputedRef } from "vue";
import { sameShortcut, SHORTCUT_KINDS, type Shortcut, type ShortcutKind } from "../../common/shortcuts";
import { isRecord } from "../../common/isRecord";
import { reconcileShortcuts } from "./reconcileShortcuts";
import { fetchJson } from "../utils/fetchJson";

const shortcuts = ref<Shortcut[]>([]);
const loadError = ref<string | null>(null);
/** True only after a GET has authoritatively populated `shortcuts`. Until then,
 *  mutations refuse to persist — a replace-all PUT built on the empty default would
 *  clobber an existing shortcuts.json. */
const loaded = ref(false);
let loadPromise: Promise<boolean> | null = null;

interface ShortcutsResponse {
  shortcuts: Shortcut[];
}

// The reader `fetchJson` requires. It checks rather than names: a pin the UI cannot navigate to
// (no slug) or cannot label (no title/icon) is dropped instead of rendered as a blank chip.
const isShortcut = (value: unknown): value is Shortcut =>
  isRecord(value) &&
  SHORTCUT_KINDS.some((kind) => kind === value.kind) &&
  typeof value.slug === "string" &&
  typeof value.title === "string" &&
  typeof value.icon === "string";

const readShortcuts = (raw: unknown): ShortcutsResponse => ({
  shortcuts: isRecord(raw) && Array.isArray(raw.shortcuts) ? raw.shortcuts.filter(isShortcut) : [],
});

// THE RULE, for both counters below: an answer is only worth adopting if nothing newer has already
// been adopted. Reads race each other, and they race WRITES — a forced re-read (Settings' Toolbar
// pins) can be issued before a pin/unpin and answer after it, carrying the file as it was. Both
// were found on PR #1991, and they are the same rule seen from two sides.
//
// `loadGeneration` orders reads against reads: a read that a newer one has overtaken is dropped,
// including its error and its retry — a stale failure must not null the promise the newer read is
// waiting on.
let loadGeneration = 0;
// `writes` orders reads against writes: `persist` adopts the server's canonical list for the file
// AFTER the write, so a read issued before it is answering about a file that no longer exists.
// Dropping that read is not a failure — the list in hand is the newer one — so the read still
// reports success.
let writes = 0;

/** Load once per session (deduped). A FAILED load is not cached so the next call
 *  retries. `force` re-reads even when a result is already cached — the file is shared with
 *  MulmoClaude, so a long-lived page can be holding a list the disk no longer matches.
 *
 *  TRUE means `shortcuts` holds the file as the server last answered for it — this read, or a write
 *  that landed while this read was out and answered about the file AFTER it. That is the question a
 *  caller about to save from the list is asking, and both answers settle it. FALSE is the two ways
 *  it is unsettled: the request failed, or a newer read overtook this one. Reading `loadError`
 *  instead answers a different question, since a failed PUT sets it too (Codex, PR #1991). */
async function load(force = false): Promise<boolean> {
  if (loadPromise && !force) return loadPromise;
  const generation = ++loadGeneration;
  const writesBefore = writes;
  loadPromise = (async () => {
    const result = await fetchJson("/api/shortcuts", readShortcuts);
    if (generation !== loadGeneration) return false;
    if (writes !== writesBefore) return true;
    if (!result.ok) {
      loadError.value = result.error;
      loadPromise = null; // allow retry
      return false;
    }
    loadError.value = null;
    shortcuts.value = result.data.shortcuts;
    loaded.value = true;
    return true;
  })();
  return loadPromise;
}

// Serialize mutations so the replace-all PUTs never overlap (two in-flight saves
// could land out of order and resurrect a removed pin). Each task awaits load()
// first so the server list is in the ref before reading `previous`.
let mutationChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(task, task);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Persist `next`, rolling back to `previous` on failure. Call only inside enqueue. */
async function persist(next: Shortcut[], previous: Shortcut[]): Promise<boolean> {
  shortcuts.value = next;
  const result = await fetchJson("/api/shortcuts", readShortcuts, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shortcuts: next }),
  });
  if (!result.ok) {
    shortcuts.value = previous;
    loadError.value = result.error;
    console.error("[useShortcuts] persist failed", result.error);
    return false;
  }
  writes += 1; // ...before adopting, so a read already in flight cannot put the old list back
  shortcuts.value = result.data.shortcuts; // adopt the server's canonical list
  loadError.value = null;
  return true;
}

function isPinned(kind: ShortcutKind, slug: string): boolean {
  return shortcuts.value.some((entry) => sameShortcut(entry, { kind, slug }));
}

function pin(shortcut: Shortcut): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false;
    if (isPinned(shortcut.kind, shortcut.slug)) return true;
    const previous = shortcuts.value;
    return persist([...previous, shortcut], previous);
  });
}

function unpin(kind: ShortcutKind, slug: string): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false;
    if (!isPinned(kind, slug)) return true;
    const previous = shortcuts.value;
    return persist(
      previous.filter((entry) => !sameShortcut(entry, { kind, slug })),
      previous,
    );
  });
}

/** Bulk reconcile one kind against the authoritative {slug,title,icon} list an
 *  index just fetched: prune dead slugs, refresh stale title/icon, self-heal the
 *  file. Other kinds untouched.
 *
 *  `live` MUST be the whole WORKSPACE's list of that kind — this prunes and persists, to a file
 *  shared with MulmoClaude, so a subset is written back as a deletion. This store cannot check
 *  that from here (it has no idea what scope produced the list), which is exactly why the caller
 *  carries the rule: collectionUi.ts refuses to call this while a project scope is active, after
 *  a project-scoped list deleted twenty-one of the user's pins on 2026-08-09. */
function reconcile(kind: ShortcutKind, live: { slug: string; title: string; icon: string }[]): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return;
    const { next, drifted } = reconcileShortcuts(shortcuts.value, kind, live);
    if (drifted) await persist(next, shortcuts.value);
  });
}

export function useShortcuts(): {
  shortcuts: ComputedRef<Shortcut[]>;
  loadError: ComputedRef<string | null>;
  load: (force?: boolean) => Promise<boolean>;
  isPinned: (kind: ShortcutKind, slug: string) => boolean;
  pin: (shortcut: Shortcut) => Promise<boolean>;
  unpin: (kind: ShortcutKind, slug: string) => Promise<boolean>;
  reconcile: (kind: ShortcutKind, live: { slug: string; title: string; icon: string }[]) => Promise<void>;
} {
  void load();
  return {
    shortcuts: computed(() => shortcuts.value),
    loadError: computed(() => loadError.value),
    load,
    isPinned,
    pin,
    unpin,
    reconcile,
  };
}
