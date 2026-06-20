// Collection-completion bells — thin host binding over
// @mulmoclaude/collection-watchers (shared with MulmoClaude). The package
// fs.watches each collection's data dir + reconciles, firing completion
// notifications through the shared @mulmoclaude/notifier singleton. This file
// injects MulmoTerminal's notification taxonomy + routing via the adapter.
//
// Depends on:
//   - the collection host being configured (initCollectionsBackend) — the
//     watchers call discoverCollections/loadCollection.
//   - the notifier being configured (initNotifier) — the watchers publish via
//     the same notifier singleton both modules import.
// So call startCollectionCompletionWatchers() AFTER both of those at boot.

import {
  configureCollectionWatchers,
  startCollectionWatchers,
  type CollectionNotificationAdapter,
  type CompletionPriority,
} from "@mulmoclaude/collection-watchers";
import type { NotifierSeverity } from "@mulmoclaude/notifier";

// Namespace these bells publish under (used for plugin-scoped clears in the
// engine; MulmoTerminal has a single notification surface so the value is
// mostly a grouping key).
const COLLECTION_PLUGIN_PKG = "collections";

/** Shape stashed on each bell entry's pluginData. The reconciler owns the
 *  internal `legacyId` (encodes slug:itemId); we round-trip it + the priority
 *  so the engine can find/refresh the entry, and the bell can deep-link. */
interface CompletionPluginData {
  kind: "collection-completion";
  legacyId: string;
  slug: string;
  itemId: string;
  priority: CompletionPriority;
}

function isCompletionData(value: unknown): value is CompletionPluginData {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return rec.kind === "collection-completion" && typeof rec.legacyId === "string";
}

const adapter: CollectionNotificationAdapter = {
  pluginPkg: COLLECTION_PLUGIN_PKG,
  priorityToSeverity: (priority): NotifierSeverity => (priority === "high" ? "urgent" : "nudge"),
  // Same-origin relative deep-link (the engine requires navigateTarget to start
  // with a single "/"). The bell parses /collections/<slug>?selected=<itemId>
  // and routes via browseNavigateToRecord (src/composables/useCollectionBrowse).
  buildNavigateTarget: (slug, itemId) => `/collections/${encodeURIComponent(slug)}?selected=${encodeURIComponent(itemId)}`,
  buildPluginData: ({ legacyId, slug, itemId, priority }): CompletionPluginData => ({ kind: "collection-completion", legacyId, slug, itemId, priority }),
  readEntry: (pluginData) => {
    if (!isCompletionData(pluginData)) return null;
    return { legacyId: pluginData.legacyId, priority: pluginData.priority === "high" ? "high" : "normal" };
  },
};

export async function startCollectionCompletionWatchers(): Promise<void> {
  configureCollectionWatchers({
    adapter,
    log: {
      info: (message, data) => console.log(`[collection-watchers] ${message}`, data ?? ""),
      warn: (message, data) => console.warn(`[collection-watchers] ${message}`, data ?? ""),
    },
  });
  await startCollectionWatchers();
}
