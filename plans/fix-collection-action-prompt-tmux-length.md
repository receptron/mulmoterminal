# fix: collection action chats die on large prompts ("command too long")

## Symptom

Pressing a collection action button (e.g. jma-weather 初期設定/使い方) opens a chat, but
"起動するだけで prompt が入力されない" — the session launches then nothing runs.

## Root cause

Action buttons auto-run the seed prompt via the `initialPrompt` path
(`spawnBackgroundChat` draft:false → `spawnClaudePty(id, null, null, message)`), which
passed the prompt to claude as a positional CLI arg (`claude … -- "<prompt>"`). But
sessions are **tmux-wrapped** for persistence (#197), and a collection seed prompt is
large (~20KB). `tmux new-session … claude … -- "<20KB>"` exceeds **tmux's command-length
limit** → tmux prints "command too long" and the session dies on spawn (`exit code 1`).

Verified: `tmux new-session … <20KB arg>` → "command too long"; a small arg or a direct
(non-tmux) spawn with the same 20KB arg is fine.

## Fix

Deliver the auto-run prompt by **typing it into claude's input box after it's ready**
(the existing draft-injection path: bracketed paste once the input-box marker paints),
then press Enter to submit. `initialPrompt` no longer goes through `buildClaudeArgs` as a
positional, so the tmux command stays short. Drafts keep their no-Enter (review) behavior;
`initialPrompt` gets the Enter (auto-run). tmux persistence is preserved.

- `server/claude-args.ts`: drop `initialPrompt` (+ the `--` positional) entirely.
- `server/index.ts`: `pendingText = draft ?? initialPrompt`; `autoSubmit` only for
  `initialPrompt`; append `\r` to the bracketed paste when auto-submitting.

## Verification

- Reproduced the exact action path (draft:false, real 20KB jma-weather prompt): before →
  "command too long" + exit 1; after → no error, claude runs the skill (reads files, runs
  `ls`/`python3 fetch.py`), spawned "via tmux" (persistence kept).
- Confirmed paste + `\r` auto-submits in claude v2.1.201 (a short prompt computed its
  answer).
- `format`/`lint`/`typecheck`/`typecheck:server`/`build`/`test` green; added a
  `claude-args` regression test asserting the argv never carries a bare `--` positional.

## Related

Complements #210/#212 (the `<collection_paths>` block): both are needed for collection
actions to fully work — #212 so the skill can resolve its paths, this so the session
doesn't die before running.
