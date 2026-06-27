// Server-side backend for @mulmoclaude/accounting-plugin. MulmoTerminal mounts the
// package's own Express router (POST /api/accounting) and injects the workspace root
// + logger + pub/sub via the package's DI seams — the server-side mirror of the Vue
// surface's configureAccountingHost (see src/composables/accountingUi.ts).
//
// Like the collection backend, this is a thin host adapter: ALL accounting logic
// (double-entry journal, reports, snapshots) lives in the package; we only supply
// the workspace and transports. Books are stored under <workspace>/data/accounting.
//
// The single-root DI (one workspaceRoot for the whole process) is exactly what the
// FOCUSED freelance product wants — one pinned business workspace. A generic
// accounting-in-MulmoTerminal would later swap this for a per-request cwd resolver
// (the dispatch request already carries the session cwd).
import type { Express } from "express";
import { configureAccountingServer, createAccountingRouter, initAccountingEventPublisher } from "@mulmoclaude/accounting-plugin/server";
import type { AccountingLogger, IPubSub } from "@mulmoclaude/accounting-plugin/server";

// Console-backed logger matching the package's AccountingLogger shape
// (namespace, message, optional structured data) — same as the collection backend.
const log: AccountingLogger = {
  error: (ns, msg, data) => console.error(`[${ns}] ${msg}`, data ?? ""),
  warn: (ns, msg, data) => console.warn(`[${ns}] ${msg}`, data ?? ""),
  info: (ns, msg, data) => console.log(`[${ns}] ${msg}`, data ?? ""),
  debug: (ns, msg, data) => console.debug(`[${ns}] ${msg}`, data ?? ""),
};

/** Wire the accounting engine to the shared workspace + pub/sub. Call once at boot,
 *  after pubsub exists and before any /api/accounting request is served. */
export function initAccountingBackend(deps: { workspace: string; pubsub: IPubSub }): void {
  configureAccountingServer({ workspaceRoot: deps.workspace, logger: log });
  // The View subscribes to raw `accounting:<bookId>` / `accounting:books` channels;
  // the engine publishes book changes here so the canvas live-refreshes after writes.
  initAccountingEventPublisher(deps.pubsub);
}

/** Mount the package's dispatch router (POST /api/accounting). Both the AccountingView
 *  (via configureAccountingHost.apiCall) and the manageAccounting host tool (see
 *  server/index.ts) drive the books through this one route. */
export function mountAccountingRoutes(app: Express): void {
  app.use(createAccountingRouter());
}
