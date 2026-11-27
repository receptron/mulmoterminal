# fix: CodeRabbit findings left unhandled on the kept-screens PRs (#3585)

Follow-up to #3575. CodeRabbit reviewed #3576 three more times after the last ledger and
reviewed #3577 once it was retargeted to main; those reviews were merged without triage.
Each finding was checked against main; all of these are real, and each fix follows the rules
in `plans/feat-keep-overlays-alive.md` (re-read on show, nothing while hidden, older-after-newer
dropped, a failed re-read keeps what is shown).

| Where | Defect | Fix |
|---|---|---|
| `BlueprintNewBuild.vue` re-read of the questions | a default is put back over an answer the person cleared; an answer the new questions no longer accept is kept, so Start sends it | defaults only for questions not asked before; kept answers pass `acceptedAnswers` |
| `BlueprintRunView.vue` draft reset | asking again, or the next round, keeps the status, so the old draft answers the new question | the reset key includes question and round |
| `BlueprintSpecReview.vue` | a read error stays after a later read works | read errors in their own state, cleared by a read that works; send errors untouched |
| `BlueprintTargets.vue` | a failed re-read over an empty list shows nothing | the failure is said whenever nothing is shown |
| `SkillEvalPanel.vue` poll | with reads slower than the tick, each tick outdates the last read and none lands | a tick waits while a read is out |
| `useLibraryData.ts` retry ticks | the same, for the list reload | a tick does not reload while one is out |
| `useLibraryMarks.ts` | a save is not counted as a read, so a later failed read says "unreadable" over shown pins | an applied save counts as read |
| `LibraryMemory.vue` | a text read from before a save or merge can replace the saved text | saving outdates reads still out |
| `SkillsOverlay.vue` | a skill removed during an edit stays after the edit ends; the empty/no-match message replaces the pane, unmounting the editor and its draft | reconcile the pick when the edit ends; those messages wait for the edit |
| `LibraryChangedFiles.vue` | the list re-read's new file object makes the watcher re-read the sides without keeping them | the watcher keeps the diff when it is the same one; the re-read no longer reads sides itself |
| config guide (en/ja), keys skill | `screen-toggle` "works on every screen" overstates two-key sequences | qualified as the `screen-*` row is |
