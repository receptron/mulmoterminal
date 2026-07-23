// Collection completion bells, shared with MulmoClaude via @mulmoclaude/core. The
// watcher fs.watches each collection's data dir; when a record the schema marks as
// "pending completion" lands (or its file/done-state changes), the reconciler drives
// the notifier: publish an "action" bell while pending, clear it when done.
//
// CROSS-APP PARITY: MulmoTerminal and MulmoClaude share ONE notifier file
// (<ws>/data/notifier/active.json) and never run simultaneously. For a record to
// carry exactly ONE bell regardless of which app published it, this adapter MUST be
// byte-identical to MulmoClaude's (server/workspace/collections/notifications.ts):
// the same pluginPkg and the same wrap/unwrap helpers (in ./collectionNotifierAdapter),
// whose `readEntry` recognises ANY legacy entry by its marker. Then MulmoTerminal's
// reconciler recognises a bell MulmoClaude already published (same legacyId) and won't
// add a duplicate — and vice-versa. Diverging here is what produced double bells.
import { configureCollectionWatchers, startCollectionWatchers } from "@mulmoclaude/core/collection-watchers";
import type { CollectionNotificationAdapter } from "@mulmoclaude/core/collection-watchers";
import { buildNavigateTarget, buildPluginData, priorityToSeverity, readEntry } from "./collectionNotifierAdapter.js";

const log = {
  info: (message: string, data?: Record<string, unknown>) => console.log(`[collection-watchers] ${message}`, data ?? ""),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[collection-watchers] ${message}`, data ?? ""),
};

const adapter: CollectionNotificationAdapter = {
  // MulmoClaude's collection bells publish under its legacy namespace; match it so
  // the shared notifier treats both apps' bells as the same entry.
  pluginPkg: "todo",
  priorityToSeverity,
  buildNavigateTarget,
  buildPluginData,
  readEntry,
};

/** Configure the adapter + mount the watchers. Fire-and-forget at boot AFTER
 *  initCollectionsBackend (the engine host) + initNotifier (the delivery sink); a
 *  watcher failure must not abort startup, so the caller attaches `.catch`. */
export async function startCollectionCompletionWatchers(): Promise<void> {
  configureCollectionWatchers({ adapter, log });
  await startCollectionWatchers();
  log.info("collection completion watchers started");
}
