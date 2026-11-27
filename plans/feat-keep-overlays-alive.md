# Keep the feature-menu screens alive between openings (#3575, part 1 of 3)

## Problem

Rooms / Library / Blueprints / Skills / Processes / Usage each re-read everything on every open, and
forget the search, the selection and the scroll on every close. Two causes, both needed for the fix:

1. Each `*Overlay.vue` is mounted for the life of the page (`App.vue`), but its body is
   `v-if="isOpen"`, so every child under it (`SessionProcessesPane`, `UsageRetrospective`,
   `BlueprintRunView`, the Library panes, ...) is created again and reads again on mount.
2. The `watch(isOpen)` in the overlay itself, or in its composables, empties what it shows before
   reading again (`SkillsOverlay` sets `catalog = null`; `useLibraryMemory` sets `projects = []`;
   `useLibraryData` clears the query and the hits on close; `RoomsOverlay` clears the messages).

## Decision

**Close hides; it does not throw away.** The body is created on the first open and then only
hidden (`v-if="everOpened" v-show="open"`). On a later open the screen shows what it had at once,
and reads again in the background, replacing what is shown when the answer arrives.

- `FullScreenOverlay` takes an `open` prop instead of being `v-if`'d by its parent, and provides
  the visibility to everything under it (`src/composables/overlayVisibility.ts`). Blueprints has
  its own frame and uses the same composable.
- **Nothing polls while hidden.** Children that poll on their own (`SessionProcessesPane`,
  `BlueprintRunView`) start and stop with the visibility. Children that read once on mount
  (`UsageRetrospective`, `WorktreeCleanupPane`) read again when shown again, keeping the old
  numbers on screen meanwhile.
- **Nothing listens while hidden.** Window key listeners already check `isOpen`; the one that does
  not (`LibraryMoreMenu`, capture phase) is closed when its screen is hidden.
- Kept across a close: Library's query, results, selected conversation and open reader; Skills'
  chosen skill, its document and the local/remote mode; Rooms' messages for the same room.
  Still guarded: a resume, a save or a read started before a close stands down (the existing
  `openings` / sequence counters stay).

## The rules everything under a kept screen follows

Keeping a screen means every component under it outlives a close. The review rounds on the PR made
each of them follow three rules; the ledger on the PR lists every place.

1. **Read again when shown again** (`onOverlayShownAgain`), including the item being read inside a
   pane (a memory's text, a repeat's detail, a skill's SKILL.md, a run's report, an open diff).
2. **Start nothing while hidden.** Polls and subscriptions stop (`whileOverlayVisible`, or a
   `null` session for a feed); a debounce, or an action answering after the close, reads nothing
   (a visibility check at the top of each refresh); showing again reads.
3. **Late answers:** an older request answering after a newer one is dropped (`latestOnly` or a
   counter). An answer that arrives while hidden is kept: it was asked before the close and is no
   older than what is shown. A failed re-read keeps what is shown, and the failure is said only
   when nothing is shown.

Deliberately not re-read on showing: the Library reader's transcript (its reload resets the scroll)
and a skills.sh document (it would contact skills.sh unasked). A child read that cascades once from
an answer accepted while hidden is an accepted cost. What a person typed is kept, except an answer
typed for a Blueprints step, which is cleared when the step changes.

## Also

`usage` was missing from `OVERLAY_ROUTES`, so hopping from Usage to another screen recorded Usage
as the place to return to.

## Not here

The return-to-terminal key and the missing `screen-*` keys (part 2), and the screen tabs (part 3).
Memory: everything opened stays in memory until reload; the largest is the Library's list, which
is already held by the always-mounted overlay today.

Follow-up: the three rules above are enforced per component by hand. One composable that owns a
kept read (re-read on show, latest-only, keep-on-failure) would let a future child get them right
by construction.
