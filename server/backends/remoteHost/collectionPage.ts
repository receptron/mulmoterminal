// Shared pagination for the remote-host collection handler.
//
// The command channel writes the result INSIDE the command document, and
// Firestore caps a document at 1 MiB. offset/limit slice the records; limit is
// clamped to [1, MAX_PAGE_LIMIT] (default 50) so a runaway page can't blow that
// budget. The clamps live in @mulmoclaude/core/remote-view (params arrive as
// untyped JSON there too) so this matches MulmoClaude's identical page semantics.
import { clampLimit, clampOffset } from "@mulmoclaude/core/remote-view";
import { deriveAll, type DerivableFieldSpec, type DerivableRecord } from "@mulmoclaude/core/collection";
import type { JsonObject } from "@mulmoclaude/core/remote-host";

export { clampLimit, clampOffset };

/** Resolve record-local computed fields (derived formulas) before paging, so the
 *  phone sees the same numbers the desktop renders. There is no ref cache over
 *  the channel, so formulas that dereference `ref` fields stay absent (parity
 *  with MulmoClaude's channel path). */
export const deriveItems = (schema: { fields?: Record<string, DerivableFieldSpec> }, items: unknown[]): DerivableRecord[] =>
  items.map((item) => deriveAll({ fields: schema.fields ?? {} }, item as DerivableRecord, {}));

/** Build the paginated result. `detail` (a CollectionDetail) and `items`
 *  (CollectionItem[]) are plain JSON, but their interfaces lack an index
 *  signature so they don't structurally match JsonValue — the cast is safe. */
export const pageResult = (detail: unknown, items: unknown[], offset: number, limit: number): JsonObject =>
  ({ collection: detail, items: items.slice(offset, offset + limit), total: items.length, offset, limit }) as unknown as JsonObject;
