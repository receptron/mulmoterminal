# fix #2108 — the Sync button on a `googleCalendar` collection

2026-09-17

## What is broken

A collection that declares `googleCalendar` and no `ingest` shows the shared plugin's
header button (label `collectionsView.syncCalendar`). Pressing it calls
`POST /api/collections/:slug/refresh`, and this host answers 400:

```
collection '<slug>' is not a feed (no ingest config)
```

Reproduced against a real server on a throwaway workspace holding one such collection,
with no Google account linked — the gate fires before anything Google-shaped is
consulted, so it is unconditional. The same collection's `calendar-push` answers 200 with
its reason in `errors`, which is the contrast that locates the defect.

## Why

`server/backends/feeds.ts`'s refresh route branches on `schema.ingest` alone.

mulmoclaude `be723e42b` (#2427) shipped both halves of the feature in one commit: the
plugin's `CollectionHeader` began offering the button for a `googleCalendar` collection,
and MulmoClaude's own refresh route gained the `syncCalendarForCollection` arm. The host
arm lives in each host's repository, so bumping the plugin here (`78018921`) brought the
button and nothing behind it. `git log --all -S "syncCalendarForCollection"` is empty in
this repo: never implemented, not regressed.

This is the failure CLAUDE.md's "MulmoClaude is the reference host" rule describes. Four
things in this repo already assume the capability exists:

- `server/backends/system-tasks.ts` says in a comment that a project's calendar
  collections "still sync on demand";
- the plugin's `CollectionRefreshResult` declares `removed?` as what a `googleCalendar`
  sync deleted — a field only a host calendar arm can fill;
- `docs/mulmoclaude-parity.md` lists `refresh` as a path both hosts share;
- nothing lets a host hide the button.

## The change

Mirror the shape already used by the opposite direction (`calendarPush.ts` +
`calendarPushResult.ts`), because these two routes are each other's counterpart and a
reader who has understood one should recognise the other.

- `common/collectionRefresh.ts` — the wire shape both sides decide from, as
  `common/collectionPush.ts` already does for the push. Both arms of the route answer it,
  so a feed arm and a calendar arm cannot drift into two response shapes.
- `server/backends/calendarRefreshResult.ts` — pure. Ports MulmoClaude's
  `calendarRefreshBody`, wording included: someone running both hosts over one workspace
  must not get two explanations for one setup problem. Reports only the requested slug's
  counts although the engine syncs the whole calendar group, and turns `not-linked` /
  `not-a-calendar` into `errors` rather than a quiet zero.
- `server/backends/calendarRefresh.ts` — the route arm, with the engine injectable so the
  outcomes can be driven without a Google grant.
- `server/backends/feeds.ts` — the gate becomes "neither `ingest` nor `googleCalendar`",
  and `ingest` wins when a schema declares both (MulmoClaude's pre-existing precedence).
- `src/composables/collectionUi.ts` — the binding is typed against that wire shape, so the
  server's response and the view's expectation are checked against each other by the compiler
  instead of being described separately on each side.
- `docs/mulmoclaude-parity.md` — a row for the collection/calendar wiring, and an entry for the
  half of #2427 this PR does not port.

## Decisions

**The root is the request's, not the workspace.** MulmoClaude calls
`syncCalendarForCollection(slug, workspacePath)` against one module-level workspace. This
host serves several roots, and every route on the collection surface resolves its own
through `resolveProjectRoot`. The calendar arm passes the same scope the `loadCollection`
beside it used, so the lookup and the sync cannot answer for different projects.

Pinned by two specs in `test/server/backends/feeds.spec.ts` that issue the refresh with a
`?project=` id naming a root that is NOT the workspace, and assert both the lookup and the arm
receive it. They are the only tests in that file where the two roots differ, which is what makes
them load-bearing: reverting either call to a module-level workspace leaves every other test in
the file green.

**`calendarSyncEnabled` does not gate the button.** The setting is read only where the
scheduled tasks are built; the manual feed refresh beside it does not consult
`feedRefreshEnabled` either, and the Settings section calls itself "Built-in scheduled
tasks … Both run hourly". So the toggle stops the hourly sync and the button still works.
MulmoClaude has no equivalent setting, so this one is decided here rather than ported.

**The 400 stays a 400.** `fetchJson` puts the server's `{error}` in front of the user, so
"declares neither" arrives as a sentence. It is also the state the button should never be
reachable in, which is what makes it a client error rather than a refusal to report.

## Out of scope

- The other half of #2427 — MulmoClaude's `startInitialCalendarSync`
  (`syncNewCalendarCollections`), which syncs a freshly declared calendar instead of
  waiting for the scheduler. Nothing is lost without it (`syncDueCalendarCollections`
  picks an unsynced collection up on the next run); it is latency, and it is a separate
  change.
- `calendarPush.ts` carries a comment justifying its 200-on-refusal divergence with
  "our `fetchJson` reports the bare `HTTP 400` and drops the body". `#913` (`e20ee14b`)
  made `fetchJson` read the body, an hour after that comment was written (`e268f5c1`).
  The route is not wrong; the reason given for it no longer holds. Raised in the PR.
