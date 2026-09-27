---
name: blueprint-refactor-tranche
description: "Take ONE target from the plan and land it without changing behaviour: guard it on the untouched code, move it verbatim, prove the equivalence by running both, mutation-sweep the tests, pass every gate, open a PR and merge it on green CI — or decline it with the cost written down."
---

# One target, one change

This step repeats. Each round does **one** target from `.blueprint/targets.json` — the first whose status
is `todo` — and nothing else. The whole claim of the change is **"this behaves the same"**, and that is
not provable by reading. What follows is how it is proved instead.

Read `.blueprint/spec.md` (the plan the person approved), `.blueprint/gates.json` (the gates) and
`.blueprint/answers.json` (`merge`: whether to merge on green CI).

## 0. The approved plan wins

The person may have changed the plan by talking to it at the review gate, which rewrites `spec.md` but not
`targets.json`. If the two disagree — a target added, dropped, reordered or reworded — bring
`targets.json` in line with `spec.md` first. Keep finished targets as they are.

## A `ci` target

Close the gaps in `.blueprint/ci.json` with the smallest change: prefer adding a step to the workflow that
already installs dependencies over a new workflow, and use the install command from `gates.json`. Every
workflow gets a top-level `permissions:` block (default `contents: read`; a job gets more only if it needs
it) and `actions/checkout` gets `persist-credentials: false`. Then continue from step 8 — the pull request's
own checks are the proof that the new CI runs and passes.

## A `tooling` target (ever-better)

- `bootstrap`: `npx -y ever-better bootstrap --dry-run` first and read the plan; then run it without
  `--dry-run`. Read every file it wrote before committing — it generates configs and a workflow, and you
  are answerable for them. Keep the change to what bootstrap produced.
- `freeze`: `npx -y ever-better freeze`, then commit what it recorded. It is a ledger, not a code change.
- After the pull request merges, add the ratchet to `.blueprint/gates.json` so every later round is held to
  it: `{ "name": "ever-better check", "command": "npx -y ever-better check --no-write", "ciMatch": "ever-better check" }`
  (`--no-write`: a gate must not change the tree; `ciMatch`: the text CI's workflow runs it by).

## When the repository runs ever-better

- Before writing a helper, `npx -y ever-better catalog`: a sixth copy of something is the opposite of tidying.
- For a change that should touch types only, `npx -y ever-better emit-diff --against origin/<default>`
  proves the emitted JavaScript did not change — a stronger proof than a replica, and cheaper.
- After a fix that removes violations, `npx -y ever-better prune` lowers the ceiling; commit it in the same
  pull request, so the ceiling falls with the change that earned it.

## 1. Start clean, and check nobody else is in the file

- On the default branch, `git pull --ff-only`. Branch: `blueprint/<target id>`.
- `gh pr list --state open` and `git log origin/<default> --oneline -20 -- <files>`. A pull request merged an
  hour ago is in neither your tree nor the open list. If someone else is changing these lines, mark the
  target `skipped` with that as the note, and stop the round.
- Confirm the target is still reachable: grep for its caller or renderer, not its import.

## 2. Find the guards before touching anything

```bash
grep -rln "<file basename>" test/ tests/ src/ --include='*.test.*' --include='*.spec.*'
grep -rn "'<identifier>'\|\"<identifier>\"" test/ tests/ src/
```

Sort the hits: **behavioural** tests call the code and break loudly. **Source-text** guards (a test that
reads a file and looks for a string, a census, an AST scan) **fail open**: when the text moves they go
vacuously green, still running and checking nothing. Each of those has to be re-pointed by what it
protected (step 5), and a guard should derive its population rather than carry a list written down.

## 3. Write the missing guard against the UNMODIFIED code

If the behaviour you are about to move — above all an ordering or a shared answer that holds only because
the code is adjacent — has no test, write one **now**, on the untouched code, where it passes. Then
**break-verify it on the untouched code**: insert exactly the defect the move could introduce and watch it
go red. A guard written after the move pins the new shape and proves nothing about the old one.

Commit the guard on its own (`test:` prefix) before the move. For a `test`-kind target this is the whole
change: tests for untested, high-value logic, each one mutation-verified (step 7).

## 4. Move the text verbatim

- The moved body is the original text with mechanical renames only. No "while I'm here" tidying — a
  cleanup mixed into a move destroys the only cheap proof you have.
- Pick the move from what the **call site** does on each path. Does this path already `await`?
  - An `async` helper suspends its caller even on a path that reaches no `await`: one more microtask before
    everything after it. Write the helper synchronous first; keep the `await` at the call site.
  - A write to shared state (a module singleton, `process.env`, a registry) and the call that reads it must
    stay in one continuation. If the region does I/O and then writes, split it: the async half returns a
    plan, a synchronous half applies it at the call site.
  - `let x;` filled by the block below it → `const x = f(…)`: the canonical, checkable move.
- Prove only the control flow changed: a multiset of the file's code lines against the default branch,
  comments stripped, should show only the inversion.
  ```bash
  strip() { grep -vE '^\s*(//|\*|/\*)' "$1" | sed 's/[[:space:]]//g' | grep -v '^$' | sort; }
  diff <(git show origin/<default>:<file> | strip /dev/stdin) <(strip <file>)
  ```

## 5. Re-point every source-text guard by what it protected

Never by where it sat. For each moved anchor: what defect was this there to catch, and where can that
defect now appear? Sometimes that is two places — inside the helper **and** around its call. Break-verify
each re-pointing.

## 6. Prove the equivalence — run both, do not reason

In order of preference:

1. **Replica differential.** Copy the OLD code verbatim into a throwaway harness and run it beside the new
   code over **generated** inputs — not inputs you chose; the ones you would think of are the ones you
   already believe are equal. Compare the whole result (`JSON.stringify` both sides), and treat a throw as
   an outcome (`ok:<value>` vs `threw:<message>`). Generate deliberately: missing keys, `null` elements,
   falsy-but-not-nullish (`0`, `''`, `false`), both alternatives of a `??`/`||` chain present at once, the
   same value at two positions, keys every object has (`constructor`, `__proto__`).
2. **Drive it** through the seam the codebase already has (an injected clock, client, or `realpath`).
3. Verbatim body plus the guards — and say out loud that this is all it rests on.

**Mutation-verify the harness** before trusting its zero: change one edited line in the new code and the
harness must report differences. A zero it cannot move off is not a measurement.

Before deleting the harness, **harvest what outlives it**: the generator (which inputs matter) and the
property (what must hold) become a permanent test.

## 7. Mutation sweep of the tests you wrote

A test that cannot fail is documentation with a green tick. For each decision you touched:

1. Hash the file. Confirm the anchor matches **exactly once**.
2. Apply the mutation, re-read the file, confirm the old text is **gone** (it landed) and that it runs
   (a duplicate object key or a compile error is not a behaviour mutation).
3. Run the tests; read the **exit code** and the thrown assertion.
4. Restore; compare the hash back.

Worth running: the helper suspends before its first statement; each guard dropped; each branch's answer
swapped; a value handed on as a copy instead of the live object. **Record mutations that stay green**
rather than silently dropping them — each is either a hole to close or a sentence saying why no input can
tell the two apart.

## 8. Gates, by exit code

Run the install and every gate from `.blueprint/gates.json`, and read `$?` — never the last line of output.
The typecheck is its own gate; a test runner that only transpiles runs code with type errors happily.

## 9. Pull request, CI, merge

- Commit with `refactor:` (or `test:` / `fix:` for what it is), adding files one by one — never `git add .`.
- Push the branch. Open a PR whose body says: what the region was, which invariant was at risk, how
  behaviour was proved (and over what inputs), which mutations went red, and **what was not proved**. Say
  what moved and how, not by how much — no line counts.
- `gh pr checks <n> --watch`. Read a red check and fix it; never retry blindly, never merge while pending.
- If `merge` is `CI が緑なら自動でマージする`: `gh pr merge <n> --merge --delete-branch`. Otherwise leave it open.
- Back to the default branch, `git pull --ff-only`, and confirm the gates are still green there.

## 10. Record the round

In `.blueprint/targets.json`, set this target's `status` to `done` with `"pr": "<url>"`. In `.blueprint/spec.md`
add one line under the target saying how it went.

**Then stop — end your turn here**, even when there are targets left and even when an answer you just got
reads like "carry on". The executor checks this round and starts the next one in a fresh session; a second
target done in this session skips that check and the next round's fresh context.

## When to decline instead

Declining with the cost written down is a real result and beats a move whose behaviour is only argued.
Set `status` to `skipped` and write `note` — what it would buy, what the risk is, and what would have to be
established first — then delete your branch (`git branch -D`, only the one you made) and return to the
default branch. Decline when:

- you cannot prove the move preserves behaviour;
- the extracted piece is itself over the bound (the finding moved rather than cleared);
- nothing reaches the code — say so and do not delete it on your own authority;
- someone else is changing the same lines.

Ask the person (and stop) only when a decision is theirs: a gate red for reasons outside this change, a fix
that would change behaviour, or a target the plan did not foresee.

Done when the check passes: every finished target's PR is merged (or open, if the person merges), the clone
is back on a clean, up-to-date default branch, every gate is green, and one more target is finished than
before this round.

## Always

- One target per round. Do not start the next one — the executor starts the next round. An answer from
  the person (say, that they merged the pull request) finishes THIS target; it is not a go-ahead for the next.
- Never force-push, rebase or squash. Never push to the default branch. Never delete a branch you did not create.
- Never silence a lint or type error to get green (`eslint-disable`, `@ts-ignore`, `as`): fix the cause or decline.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
