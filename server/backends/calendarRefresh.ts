// The `googleCalendar` arm of the collection refresh route — sync now, on the user's click,
// instead of waiting for the hourly system task.
//
// A thin host adapter, like calendarPush.ts next door: @mulmoclaude/core/google owns the sync
// token, the window walk and the record writes (`syncCalendarForCollection`), so the host
// supplies only the root and the wire shape. The Google host itself is configured once at boot
// by initGoogleBackend().
//
// Deliberately NOT gated on the `calendarSyncEnabled` setting. That setting is read where the
// scheduled tasks are built, and the manual feed refresh beside this one does not consult
// `feedRefreshEnabled` either — the Settings section it lives in calls itself "Built-in
// scheduled tasks … Both run hourly". Switching it off stops the hourly sync, not the button.
import type { ManualCalendarSyncOutcome } from "@mulmoclaude/core/google";
import { syncCalendarForCollection } from "@mulmoclaude/core/google";
import type { CollectionRefreshResult } from "../../common/collectionRefresh.js";
import { calendarRefreshResult } from "./calendarRefreshResult.js";
import { hostLogger } from "./hostLogger.js";

/** The engine call, injectable so the route's three outcomes can be driven without a
 *  workspace on disk or a live Google grant — the shape `calendarPush.ts` uses for the same
 *  reason. */
export type CalendarSync = (slug: string, workspaceRoot: string) => Promise<ManualCalendarSyncOutcome>;

/** Sync the calendar ONE collection reads, and report that collection's own counts.
 *
 *  `workspaceRoot` is the REQUEST's root, not the workspace: this host serves several, and the
 *  `loadCollection` that admitted the slug resolved the same one. Reading a second root here
 *  would sync a project's collection against the workspace — or find nothing to sync at all. */
export async function syncCalendarCollection(
  slug: string,
  workspaceRoot: string,
  sync: CalendarSync = syncCalendarForCollection,
): Promise<CollectionRefreshResult> {
  const body = calendarRefreshResult(slug, await sync(slug, workspaceRoot));
  hostLogger.info("calendar-sync", "synced via collection route", { slug, written: body.written, removed: body.removed, errors: body.errors.length });
  return body;
}
