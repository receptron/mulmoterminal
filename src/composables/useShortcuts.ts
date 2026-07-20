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
import { sameShortcut, type Shortcut, type ShortcutKind } from "../types/shortcuts";
import { fetchJson } from "../utils/fetchJson";

const shortcuts = ref<Shortcut[]>([]);
const loadError = ref<string | null>(null);
/** True only after a GET has authoritatively populated `shortcuts`. Until then,
 *  mutations refuse to persist — a replace-all PUT built on the empty default would
 *  clobber an existing shortcuts.json. */
const loaded = ref(false);
let loadPromise: Promise<void> | null = null;

interface ShortcutsResponse {
  shortcuts: Shortcut[];
}

/** Load once per session (deduped). A FAILED load is not cached so the next call
 *  retries. */
async function load(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const result = await fetchJson<ShortcutsResponse>("/api/shortcuts");
    if (!result.ok) {
      loadError.value = result.error;
      loadPromise = null; // allow retry
      return;
    }
    loadError.value = null;
    shortcuts.value = result.data.shortcuts;
    loaded.value = true;
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
  const result = await fetchJson<ShortcutsResponse>("/api/shortcuts", {
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
 *  file. Other kinds untouched. */
function reconcile(kind: ShortcutKind, live: { slug: string; title: string; icon: string }[]): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return;
    const liveBySlug = new Map(live.map((entry) => [entry.slug, entry]));
    let drifted = false;
    const next = shortcuts.value.flatMap((entry) => {
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
    if (drifted) await persist(next, shortcuts.value);
  });
}

export function useShortcuts(): {
  shortcuts: ComputedRef<Shortcut[]>;
  loadError: ComputedRef<string | null>;
  load: (force?: boolean) => Promise<void>;
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
