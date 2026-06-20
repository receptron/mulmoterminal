import { ref, computed, onMounted, onUnmounted } from "vue";
import { usePubSub } from "./usePubSub";
import { browseNavigateToRecord } from "./useCollectionBrowse";

// Local mirror of @mulmoclaude/notifier's value types. Repeated here rather than
// imported because that package is server-only (node:fs / crypto) — the bell
// only needs the JSON shape that arrives over pubsub / the REST list.
export type NotifierSeverity = "info" | "nudge" | "urgent";

export interface NotifierEntry {
  id: string;
  pluginPkg: string;
  severity: NotifierSeverity;
  title: string;
  body?: string;
  navigateTarget?: string;
  createdAt: string;
  pluginData?: unknown;
}

type NotifierEvent =
  | { type: "published"; entry: NotifierEntry }
  | { type: "cleared"; id: string }
  | { type: "cancelled"; id: string }
  | { type: "updated"; entry: NotifierEntry };

// Must match server/backends/notifier.ts NOTIFIER_CHANNEL.
const NOTIFIER_CHANNEL = "notifier";

// Worst-wins ordering so the badge can colour by the most urgent active entry.
const SEVERITY_RANK: Record<NotifierSeverity, number> = { info: 0, nudge: 1, urgent: 2 };

/** Parse a same-origin navigateTarget the watchers produce
 *  (/collections/<slug>?selected=<itemId>) into its parts, or null. String ops
 *  (no regex) so there's no ReDoS surface. Exported for testing. */
export function parseCollectionTarget(target: string | undefined): { slug: string; itemId?: string } | null {
  const PREFIX = "/collections/";
  if (!target || !target.startsWith(PREFIX)) return null;
  const rest = target.slice(PREFIX.length);
  const [pathPart, query] = rest.split("?");
  const slugSegment = pathPart.split("/")[0];
  if (!slugSegment) return null;
  const slug = decodeURIComponent(slugSegment);
  const selected = query ? new URLSearchParams(query).get("selected") : null;
  return { slug, itemId: selected ?? undefined };
}

export function useNotifications() {
  const entries = ref<NotifierEntry[]>([]);
  const open = ref(false);

  const count = computed(() => entries.value.length);
  // Newest first.
  const sorted = computed(() => [...entries.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  const topSeverity = computed<NotifierSeverity | null>(() =>
    entries.value.reduce<NotifierSeverity | null>(
      (worst, entry) => (worst === null || SEVERITY_RANK[entry.severity] > SEVERITY_RANK[worst] ? entry.severity : worst),
      null,
    ),
  );

  async function load() {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      entries.value = Array.isArray(data.entries) ? (data.entries as NotifierEntry[]) : [];
    } catch {
      // Runs on mount + could be retried; a transient failure keeps the
      // current list rather than blanking the bell.
    }
  }

  function apply(event: NotifierEvent): void {
    if (event.type === "published" || event.type === "updated") {
      const idx = entries.value.findIndex((entry) => entry.id === event.entry.id);
      if (idx >= 0) entries.value[idx] = event.entry;
      else entries.value = [event.entry, ...entries.value];
    } else {
      entries.value = entries.value.filter((entry) => entry.id !== event.id);
    }
  }

  async function dismiss(id: string): Promise<void> {
    // Optimistic; the pubsub "cleared" event reconciles either way.
    entries.value = entries.value.filter((entry) => entry.id !== id);
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}/clear`, { method: "POST" });
    } catch {
      // Best-effort.
    }
  }

  /** Row click: navigate to the entry's target (if any) and close the panel. We
   *  deliberately do NOT clear — completion bells are action-lifecycle
   *  obligations the watcher clears when the record is actually done; clearing
   *  on click would just flicker (the next reconcile re-publishes it). */
  function activate(entry: NotifierEntry): void {
    const target = parseCollectionTarget(entry.navigateTarget);
    if (target) browseNavigateToRecord(target.slug, target.itemId);
    open.value = false;
  }

  const { subscribe } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  onMounted(() => {
    load();
    unsubscribe = subscribe(NOTIFIER_CHANNEL, (data) => apply(data as NotifierEvent));
  });
  onUnmounted(() => unsubscribe?.());

  return { entries, sorted, count, topSeverity, open, load, dismiss, activate };
}
