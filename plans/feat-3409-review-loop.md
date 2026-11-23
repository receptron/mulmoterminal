# feat: the server runs the review loop (#3409, part A)

Child 3 of #3403, first of three PRs. The session driving a PR asks for one review round at a time;
the server sends it, waits, records it, and types the result back. Parts B (the mothership skill) and
C (the board) follow.

## Tools

- `requestReview { repo, pr, reviewer }` — `reviewer` is a session the caller started with
  `spawnBackgroundChat` (sendToSession's addressing rule). Returns at once.
- `endReview { repo, pr }` — drops the loop, abandons a running round, closes the reviewer's cell.

## A round

1. Checks, in order: caller is a terminal; reviewer was started by it; the repository declares
   `review` (#3407); the reviewer runs the declared agent; the PR is open; the loop allows a round
   (`roundRefusal`: same author, same reviewer, none running, under `maxRounds`, not a head that had
   changes requested, not a head that already has its LGTMs), and the reviewer reviews no other PR
   (`reviewerRefusal`). A loop whose author is no longer running is dropped, so the PR can be taken over.
2. The loop is claimed with no await between the last check and `running = true`, so two racing
   calls send one round.
3. The prompt (`reviewPrompt`) names the PR and head, asks for every finding at once with severity,
   a first line `REVIEW VERDICT: LGTM|CHANGES REQUESTED (head <sha>)`, and the same reply posted as a
   PR comment; it forbids touching an existing checkout. Tagged like sendToSession, and remembered,
   so `waitForSessionReply` reads the full review at once.
4. In the background: `awaitReply` for up to `REVIEW_WAIT_MINUTES`, cut short when the reviewer
   stops running (that round is not counted). The verdict is read with the board's parser, now
   accepting `REVIEW VERDICT:` beside `CODEX VERDICT:`, and counts only when it names the head that
   was asked about (`verdictFor`).
5. The PR is read again (head, CI) and `roundEndMessage` is typed into the author: the verdict, the
   rounds left, and "merge condition met" only for the declared LGTMs on the CURRENT head with CI
   passing. The loop stays claimed until that message is written, so a next round cannot append
   first. A dialog open in the author holds it back and it is retried; after the paste it stays in
   the input box. `endReview` stops a held-back result from being typed at all.

## Decisions

- The server never merges (#1183).
- The reviewer is spawned by the author, not the server: the spawn path stays one place, and the
  reviewer is visible as a cell like any other spawn.
- Repeated findings are not detected mechanically: the reviewer keeps its own context and is asked
  to flag repeats; the server stops on the same head and on `maxRounds`.
- Loops live in memory; a restart forgets them (as it forgets who spawned whom).
