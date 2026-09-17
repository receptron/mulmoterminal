// The `POST /api/collections/:slug/refresh` response. One shape for BOTH arms of that
// route — a declarative/agent feed's `ingest` re-run and a `googleCalendar` sync — because
// the collection view reads one result whichever arm answered, and two host-side shapes for
// one button is how a field ends up set by one arm and never read from the other.
//
// It mirrors MulmoClaude's `CollectionRefreshBody` (server/api/routes/collectionCalendarRefresh.ts)
// so the two hosts over the shared workspace answer the same plugin identically. Re-stated
// rather than imported, for `collectionPush.ts`'s reason: the plugin ships its
// `CollectionRefreshResult` from `@mulmoclaude/collection-plugin/vue`, and the server has no
// business pulling a Vue package in to describe its own response.
//
// An absent field is an ABSENT KEY, never an explicit `undefined`. That is what the wire carries
// either way (JSON.stringify drops an undefined value), and under `exactOptionalPropertyTypes` it
// is also what makes this assignable to the plugin's own `CollectionRefreshResult` — so the
// binding in `collectionUi.ts` type-checks the server's shape against the view's expectation
// instead of both sides describing it separately.

export interface CollectionRefreshResult {
  /** Always true — "the refresh ran", not "records changed". A refusal is told through
   *  `errors`, the way the push's `pushed` works. */
  refreshed: true;
  written: number;
  /** Why the refresh did not do what was asked. Read beside the button, so an empty list is
   *  the only thing that means "it worked". */
  errors: string[];
  /** Records a `googleCalendar` sync deleted (the event was cancelled in Google). Sent by the
   *  calendar arm only: the feed engine counts its own `maxItems` evictions, but the feed arm
   *  has never reported them and MulmoClaude's does not either. */
  removed?: number;
  /** An agent-ingest feed dispatched a worker session instead of writing records itself. */
  dispatched?: boolean;
  /** The dispatched session, for the view to navigate to. */
  chatId?: string;
}
