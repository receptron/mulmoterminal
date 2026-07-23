// The pure wrap/unwrap helpers behind MulmoTerminal's collection-completion bells.
// CROSS-APP PARITY: these MUST stay byte-identical to MulmoClaude's
// (server/workspace/collections/notifications.ts) so a bell either app published
// carries the same shape and the same `legacyId` — otherwise a record recognised by
// only one app's `readEntry` gets a second bell. The legacy types live in
// MulmoClaude's app source (not the published package), so the shape is mirrored
// here rather than imported.
import type { CompletionPriority } from "@mulmoclaude/core/collection-watchers";
import type { NotifierSeverity } from "@mulmoclaude/core/notifier";

// `legacy: true` + a string `legacyId` + a string `kind` is the marker both apps'
// readEntry recognise; the navigate `action` preserves the bell's icon/routing.
export interface LegacyNotifierPluginData {
  legacy: true;
  legacyId: string;
  kind: "todo";
  priority: "normal" | "high";
  action: { type: "navigate"; target: { view: "collections"; slug: string; itemId: string } };
}

export function isLegacyNotifierPluginData(value: unknown): value is LegacyNotifierPluginData {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return rec.legacy === true && typeof rec.legacyId === "string" && typeof rec.kind === "string";
}

/** Deep-link the bell row navigates to: `/collections/<slug>?selected=<itemId>` (the
 *  documented record permalink). Dot-segment slugs would normalise out of the route,
 *  so fall back to the index — matches MulmoClaude's builder. */
export function buildNavigateTarget(slug: string, itemId: string): string {
  if (slug === "." || slug === "..") return "/collections";
  const base = `/collections/${encodeURIComponent(slug)}`;
  return itemId ? `${base}?selected=${encodeURIComponent(itemId)}` : base;
}

// high → urgent (red), normal → nudge (amber). Never "info" — the engine forbids
// info-severity action entries.
export function priorityToSeverity(priority: CompletionPriority): NotifierSeverity {
  return priority === "high" ? "urgent" : "nudge";
}

export function buildPluginData(input: { legacyId: string; slug: string; itemId: string; priority: CompletionPriority }): LegacyNotifierPluginData {
  const { legacyId, slug, itemId, priority } = input;
  return {
    legacy: true,
    legacyId,
    kind: "todo",
    priority: priority === "high" ? "high" : "normal",
    action: { type: "navigate", target: { view: "collections", slug, itemId } },
  };
}

export function readEntry(pluginData: unknown): { legacyId: string; priority: CompletionPriority } | null {
  if (!isLegacyNotifierPluginData(pluginData)) return null;
  const priority: CompletionPriority = pluginData.priority === "high" ? "high" : "normal";
  return { legacyId: pluginData.legacyId, priority };
}
