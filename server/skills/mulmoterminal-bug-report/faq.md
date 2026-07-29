# MulmoTerminal FAQ — check these before calling it a bug

This file is an **index, not an answer sheet**. It never states a value ("the default is X"), only
where today's truth lives, because the skill reads the real thing at run time. Values rot silently;
a config key or a file path cannot — rename one and the implementation stops working, so it gets
fixed.

Each entry's `configKey:` / `source:` / `guide:` lines are **verified by CI**: a key that no longer
exists, or a path that moved, fails the test rather than misleading a user months later.

Entry format:

```
## The symptom, in the words a user would say

configKey: <a global or per-directory config key>   (optional, repeatable)
source: <path to the implementation in this repo>   (optional, repeatable)
guide: <path to the user guide page in this repo>   (optional, repeatable)

What to check. Never what the value is.
```

Maintained by hand, in this repo. Questions posted as FAQ issues are reviewed by a maintainer and
folded in here — this file is the source of truth, the issue tracker is the inbox.

---

## Enter does not submit, or inserts a newline when I meant to submit

configKey: terminalSubmit
source: common/terminalSubmit.ts
source: server/config/app-config.ts
guide: docs/guide/en/config.md

Which bytes mean *submit* and which mean *newline* is configurable. Read the **current** value from
the global config (`~/.mulmoterminal/config.json`) and the accepted values from
`common/terminalSubmit.ts`. It applies to Claude sessions only — shell and codex sessions always
take a plain CR. Suspect a bug only when the setting and the observed behaviour disagree.

## My sessions are gone after a restart

source: server/infra/tmux.ts
guide: docs/guide/en/basics.md

Sessions survive a server restart **because of tmux**. Check whether it is installed (`tmux -V`).
On a host without it, losing them is expected. If tmux IS installed and they still vanish, that is
bug-shaped — carry on to the next step.

## Colours, name badge, header buttons or chips don't show up

configKey: buttons
configKey: chips
source: server/config/config-schema.ts
guide: docs/guide/en/config.md

Appearance and header contents come from the per-directory `.mulmoterminal.json` plus the global
`buttons` / `chips`. Check that the file exists in the directory in question and that its shape
matches the schema in `server/config/config-schema.ts`. If the user needs to write one, hand off to
`/mulmoterminal-config` rather than dictating JSON from memory.

## No notifications arrive on my phone

configKey: pushEnabled
source: server/backends/notifier.ts
guide: docs/guide/en/notifications.md

Pushes are sent only when several conditions hold at once, and some sessions are excluded by
design. The conditions and the exclusions are listed in the notifications guide — walk them in
order (RemoteHost connected, the toggle on, at least one registered device) before treating it as a
bug.

## Can't select or copy text that scrolled off screen (or no scrollbar) in a Claude/Codex terminal

source: server/infra/tmux.ts
source: src/composables/useTerminalConnections.ts
source: docs/terminal-notes.md

Not a renderer bug — the canvas-mismatch theory was ruled out, and the OSC 8 "links aren't
clickable" half was tmux stripping hyperlinks (fixed in #785). tmux owns the scrollback, so the
outer terminal only ever holds the visible screen. A **shell** cell keeps its history in tmux and
can be drag-selected; a **Claude/Codex** cell runs in the alternate screen, which has no scrollback
at all (its tmux `history_size` is 0) — the app redraws its own transcript as you scroll. Selecting
that scrolled-off history is therefore impossible in ANY terminal (VS Code / iTerm included), not
specific to this app. Workaround: to copy long output from a Claude/Codex cell, redirect it to a
file and open it in the browser viewer (source/text files render inline, #785), or select
screen-by-screen. Background and the parked shell-cell fix live in #782 and docs/terminal-notes.md;
**do not open a new issue** — add repro details to #782.

Scrolling that history with the wheel does work, and is a separate thing from selecting it. If the
wheel itself stops moving a Claude/Codex cell after a reload or a session switch, that was #1073 —
the alternate-screen SET fell off the front of the bounded replay, so the browser came back in the
normal buffer and the wheel had nothing to deliver to. Fixed by restoring the pane's modes from
tmux ahead of the replay; on a version that has the fix, report it as a new bug.

## The phone's terminal view shows no directory or branch

source: server/backends/remoteHost/terminalScreen.ts

Fields the host cannot answer are omitted entirely — a session that outlived a restart has no PTY
left, so it has neither a directory nor a branch to report. The phone side also needs a version
that renders them. Suspect a bug only when the host does hold the value and it still doesn't show.
