// Collection completion bells, shared with MulmoClaude via @mulmoclaude/core. The
// watcher fs.watches each collection's data dir; when a record the schema marks as
// "pending completion" lands (or its file/done-state changes), the reconciler drives
// the notifier: publish an "action" bell while pending, clear it when done.
//
// CROSS-APP PARITY: MulmoTerminal and MulmoClaude share ONE notifier file
// (<ws>/data/notifier/active.json) and never run simultaneously. For a record to
// carry exactly ONE bell regardless of which app published it, this adapter MUST be
// byte-identical to MulmoClaude's (server/workspace/collections/notifications.ts):
// the same pluginPkg, the same `LegacyNotifierPluginData` shape, and a `readEntry`
// that recognises ANY legacy entry by its marker. Then MulmoTerminal's reconciler
// recognises a bell MulmoClaude already published (same legacyId) and won't add a
// duplicate — and vice-versa. Diverging here is what produced double bells.
//
// The legacy types live in MulmoClaude's app source (not the published package), so
// the small shape is mirrored locally rather than imported.
import { configureCollectionWatchers, startCollectionWatchers } from "@mulmoclaude/core/collection-watchers";
import type { CollectionNotificationAdapter, CompletionPriority } from "@mulmoclaude/core/collection-watchers";

const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[collection-watchers] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[collection-watchers] ${message}`, data ?? ""),
};

// Mirror of MulmoClaude's LegacyNotifierPluginData (the subset collection bells use).
// `legacy: true` + a string `legacyId` + a string `kind` is the marker both apps'
// readEntry recognise; the navigate `action` preserves the bell's icon/routing.
interface LegacyNotifierPluginData {
  legacy: true;
  legacyId: string;
  kind: "todo";
  priority: "normal" | "high";
  action: { type: "navigate"; target: { view: "collections"; slug: string; itemId: string } };
}

function isLegacyNotifierPluginData(value: unknown): value is LegacyNotifierPluginData {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return rec.legacy === true && typeof rec.legacyId === "string" && typeof rec.kind === "string";
}

/** Deep-link the bell row navigates to: `/collections/<slug>?selected=<itemId>` (the
 *  documented record permalink). Dot-segment slugs would normalise out of the route,
 *  so fall back to the index — matches MulmoClaude's builder. */
function buildNavigateTarget(slug: string, itemId: string): string {
  if (slug === "." || slug === "..") return "/collections";
  const base = `/collections/${encodeURIComponent(slug)}`;
  return itemId ? `${base}?selected=${encodeURIComponent(itemId)}` : base;
}

const adapter: CollectionNotificationAdapter = {
  // MulmoClaude's collection bells publish under its legacy namespace; match it so
  // the shared notifier treats both apps' bells as the same entry.
  pluginPkg: "todo",
  // high → urgent (red), normal → nudge (amber). Never "info" — the engine forbids
  // info-severity action entries.
  priorityToSeverity: (priority) => (priority === "high" ? "urgent" : "nudge"),
  buildNavigateTarget,
  buildPluginData: ({ legacyId, slug, itemId, priority }): LegacyNotifierPluginData => ({
    legacy: true,
    legacyId,
    kind: "todo",
    priority: priority === "high" ? "high" : "normal",
    action: { type: "navigate", target: { view: "collections", slug, itemId } },
  }),
  readEntry: (pluginData) => {
    if (!isLegacyNotifierPluginData(pluginData)) return null;
    const priority: CompletionPriority = pluginData.priority === "high" ? "high" : "normal";
    return { legacyId: pluginData.legacyId, priority };
  },
};

/** Configure the adapter + mount the watchers. Fire-and-forget at boot AFTER
 *  initCollectionsBackend (the engine host) + initNotifier (the delivery sink); a
 *  watcher failure must not abort startup, so the caller attaches `.catch`. */
export async function startCollectionCompletionWatchers(): Promise<void> {
  configureCollectionWatchers({ adapter, log });
  await startCollectionWatchers();
  log.info("collection completion watchers started");
}
