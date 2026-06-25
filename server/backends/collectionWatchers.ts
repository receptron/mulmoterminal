// Collection completion bells, shared with MulmoClaude via @mulmoclaude/core. The
// watcher fs.watches each collection's data dir; when a record that the schema marks
// as "pending completion" lands (or its file/done-state changes), the reconciler
// drives the notifier: publish an "action" bell while pending, clear it when done.
//
// The reconciler owns an internal `legacyId` (slug+itemId) round-tripped through the
// entry's pluginData. This adapter is the MulmoTerminal-specific delivery sink: it
// chooses the bell's plugin namespace, severity mapping, deep-link target, and the
// pluginData shape that lets the reconciler recognise its own entries on a rescan.
import { configureCollectionWatchers, startCollectionWatchers } from "@mulmoclaude/core/collection-watchers";
import type { CollectionNotificationAdapter, CompletionPriority } from "@mulmoclaude/core/collection-watchers";

const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[collection-watchers] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[collection-watchers] ${message}`, data ?? ""),
  error: (message: string, data?: Record<string, unknown>) => console.error(`[collection-watchers] ${message}`, data ?? ""),
};

// The pluginData this reconciler stores on each completion bell. `kind` lets readEntry
// recognise our entries on a listAll() scan and skip foreign ones.
interface CompletionPluginData {
  kind: "collection-completion";
  legacyId: string;
  slug: string;
  itemId: string;
  priority: CompletionPriority;
  navigateTarget: string;
}

/** Deep-link the bell row navigates to: the collections browse overlay focused on the
 *  pending record. The frontend parses this back to (slug, itemId). */
function buildNavigateTarget(slug: string, itemId: string): string {
  return `/collections/${encodeURIComponent(slug)}?selected=${encodeURIComponent(itemId)}`;
}

const adapter: CollectionNotificationAdapter = {
  pluginPkg: "collections",
  // A high-priority pending record is a real obligation (red); anything else nudges
  // (amber). Never "info" — the engine forbids info-severity action entries.
  priorityToSeverity: (priority) => (priority === "high" ? "urgent" : "nudge"),
  buildNavigateTarget,
  buildPluginData: ({ legacyId, slug, itemId, priority, navigateTarget }) =>
    ({ kind: "collection-completion", legacyId, slug, itemId, priority, navigateTarget }) satisfies CompletionPluginData,
  readEntry: (pluginData) => {
    if (typeof pluginData !== "object" || pluginData === null) return null;
    const data = pluginData as Partial<CompletionPluginData>;
    if (data.kind !== "collection-completion" || typeof data.legacyId !== "string") return null;
    return { legacyId: data.legacyId, priority: data.priority === "high" ? "high" : "normal" };
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
