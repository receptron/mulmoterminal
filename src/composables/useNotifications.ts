// Toolbar notification state. Mirrors MulmoClaude's useNotifications: a module-level
// singleton that fetches the active set once, then keeps it live by subscribing to
// the notifier pubsub channel. The bell (NotificationBell.vue) reads count /
// topSeverity / sorted and calls dismiss / activate.
//
// Server-only @mulmoclaude/core/notifier types are NOT imported here (that would pull
// node code into the browser bundle); the small value types are mirrored locally,
// matching the wire shape the server's /api/notifications + NotifierEvent emit.
import { ref, computed } from "vue";
import { usePubSub } from "./usePubSub";
import { browseNavigateToRecord } from "./useCollectionBrowse";

// Must match server/backends/notifier.ts NOTIFIER_CHANNEL.
const NOTIFIER_CHANNEL = "notifications";

export type NotifierSeverity = "info" | "nudge" | "urgent";
export type NotifierLifecycle = "fyi" | "action";

export interface NotifierEntry {
  id: string;
  pluginPkg: string;
  severity: NotifierSeverity;
  lifecycle?: NotifierLifecycle;
  title: string;
  body?: string;
  navigateTarget?: string;
  pluginData?: unknown;
  createdAt: string;
}

// Discriminated union mirroring the server's NotifierEvent.
type NotifierEvent =
  | { type: "published"; entry: NotifierEntry }
  | { type: "updated"; entry: NotifierEntry }
  | { type: "cleared"; id: string }
  | { type: "cancelled"; id: string };

const SEVERITY_RANK: Record<NotifierSeverity, number> = { info: 0, nudge: 1, urgent: 2 };

const active = ref<NotifierEntry[]>([]);
let initialized = false;

/** Parse a collection deep-link (`/collections/<slug>?selected=<itemId>`) into its
 *  parts. String ops + URLSearchParams only — no regex (lint bans backtracking-prone
 *  patterns). Returns null for anything that isn't a collection target. */
export function parseCollectionTarget(target: string | undefined): { slug: string; itemId?: string } | null {
  if (!target) return null;
  const prefix = "/collections/";
  if (!target.startsWith(prefix)) return null;
  const rest = target.slice(prefix.length);
  const queryAt = rest.indexOf("?");
  const rawSlug = queryAt === -1 ? rest : rest.slice(0, queryAt);
  if (!rawSlug) return null;
  let itemId: string | undefined;
  if (queryAt !== -1) {
    // URLSearchParams.get() returns an already-decoded value — decoding again would
    // throw "URI malformed" on a valid id containing a literal "%" (e.g. "100% done").
    const selected = new URLSearchParams(rest.slice(queryAt + 1)).get("selected");
    if (selected) itemId = selected;
  }
  // The slug was string-sliced (not via URLSearchParams), so it is still encoded.
  return { slug: decodeURIComponent(rawSlug), itemId };
}

function upsert(entry: NotifierEntry): void {
  const idx = active.value.findIndex((existing) => existing.id === entry.id);
  if (idx === -1) active.value.push(entry);
  else active.value.splice(idx, 1, entry);
}

function remove(id: string): void {
  const idx = active.value.findIndex((existing) => existing.id === id);
  if (idx !== -1) active.value.splice(idx, 1);
}

function applyEvent(event: NotifierEvent): void {
  switch (event.type) {
    case "published":
    case "updated":
      upsert(event.entry);
      break;
    case "cleared":
    case "cancelled":
      remove(event.id);
      break;
  }
}

async function fetchActive(): Promise<void> {
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) {
      console.error(`[notifications] list failed: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { active?: NotifierEntry[] };
    active.value = Array.isArray(data.active) ? data.active : [];
  } catch (err) {
    console.error("[notifications] list failed", err);
  }
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const pubsub = usePubSub();
  pubsub.subscribe(NOTIFIER_CHANNEL, (data) => applyEvent(data as NotifierEvent));
  // pubsub only replays room membership on reconnect, not the events missed while
  // disconnected — re-fetch the authoritative list so the bell can't go stale.
  pubsub.onReconnect(() => void fetchActive());
  void fetchActive();
}

export function useNotifications() {
  ensureInit();

  const count = computed(() => active.value.length);

  const topSeverity = computed<NotifierSeverity | null>(() => {
    let top: NotifierSeverity | null = null;
    for (const entry of active.value) {
      if (top === null || SEVERITY_RANK[entry.severity] > SEVERITY_RANK[top]) top = entry.severity;
    }
    return top;
  });

  // Worst-severity first, then newest first within a severity.
  const sorted = computed(() =>
    [...active.value].sort((left, right) => {
      const bySeverity = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
      if (bySeverity !== 0) return bySeverity;
      return right.createdAt.localeCompare(left.createdAt);
    }),
  );

  /** Dismiss (clear) a notification: the ✕ action. Optimistically drops it, then
   *  asks the server to clear; on failure we resync from the server. */
  async function dismiss(id: string): Promise<void> {
    remove(id);
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/clear`, { method: "POST" });
      if (!res.ok) {
        console.error(`[notifications] clear failed: HTTP ${res.status}`);
        await fetchActive();
      }
    } catch (err) {
      console.error("[notifications] clear failed", err);
      await fetchActive();
    }
  }

  /** Row click: navigate to the entry's target if it's a collection record. Does NOT
   *  clear — completion bells are action obligations the watcher clears when the
   *  record is done. Returns true if it navigated. */
  function activate(entry: NotifierEntry): boolean {
    const parsed = parseCollectionTarget(entry.navigateTarget);
    if (!parsed) return false;
    browseNavigateToRecord(parsed.slug, parsed.itemId);
    return true;
  }

  return { active, count, topSeverity, sorted, dismiss, activate };
}
