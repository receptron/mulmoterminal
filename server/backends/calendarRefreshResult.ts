import type { CalendarCollectionSyncResult, ManualCalendarSyncOutcome } from "@mulmoclaude/core/google";
import type { CollectionRefreshResult } from "../../common/collectionRefresh.js";

// Shape a manual Google Calendar sync into the response the collection view already
// understands from a feed refresh.
//
// Ports MulmoClaude's `calendarRefreshBody` (server/api/routes/collectionCalendarRefresh.ts),
// wording included: both hosts drive the same plugin over the same workspace, so a user who
// runs both must not get two different explanations for one setup problem.
//
// Pure, so the reporting rule — which counts belong to the requested collection, and which
// states must not read as a successful empty sync — is testable without a workspace on disk
// or a Google grant.

export const CALENDAR_NOT_LINKED_ERROR = "no Google account is linked on this host — link it in Settings → Google";
export const CALENDAR_NOT_DECLARED_ERROR = "this collection no longer declares a `googleCalendar` block";

function totals(results: readonly CalendarCollectionSyncResult[], pick: (result: CalendarCollectionSyncResult) => number): number {
  return results.reduce((total, result) => total + pick(result), 0);
}

/** A sync of the whole calendar group reported for ONE collection: the group fan-out is a
 *  correctness requirement of the shared sync token (consuming a window for one collection
 *  would leave the others on that calendar reading an already-consumed one), but the user
 *  asked about `slug`, so only its own counts are reported.
 *
 *  `unwritable` events join `errors` even though they never retry — the clicking user is the
 *  one person who can act on them. `withheld` does not: it is a local edit deliberately kept,
 *  which the next push reports, not a failure of this sync. */
export function calendarRefreshResult(slug: string, outcome: ManualCalendarSyncOutcome): CollectionRefreshResult {
  if (outcome.kind === "not-linked") return { refreshed: true, written: 0, errors: [CALENDAR_NOT_LINKED_ERROR] };
  if (outcome.kind === "not-a-calendar") return { refreshed: true, written: 0, errors: [CALENDAR_NOT_DECLARED_ERROR] };
  const own = outcome.results.filter((result) => result.slug === slug);
  return {
    refreshed: true,
    written: totals(own, (result) => result.written),
    removed: totals(own, (result) => result.removed),
    errors: own.flatMap((result) => [...result.errors, ...result.unwritable]),
  };
}
