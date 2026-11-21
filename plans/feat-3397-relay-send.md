# feat: send this cell's turn to a partner cell (#3397)

The handoff only pulled (#550, #574, #3389). This adds SEND, and makes both directions cell actions,
so a header button (`run: "action"`), a `keymap` binding and the command palette can name them.

## Actions

| name | what it does |
|---|---|
| `terminal-send-turn` | this cell's last exchange, pasted into the partner |
| `terminal-send-since` | this cell's exchanges since the last relay to the partner's directory |
| `terminal-bring-turn` | the partner's last exchange, pasted here (the menu's "Bring that turn here") |
| `terminal-bring-since` | the partner's exchanges since the last relay here (#3389) |

Names, not a parameter: header actions, keymap and palette share one list of bare names.

## Partner

Another readable agent cell in the same repo: this cell's directory, or anywhere inside any of the
repo's worktrees (`/api/worktrees?cwd=` lists them), this cell's own checkout included — "another
directory of the same repo" was the ask, and a subdirectory of the same checkout is one. Outside git,
only the same directory. Pure rule in `src/composables/relayPartners.ts`.

The paste lands only while the destination still runs the session it ran when the action started
(the check useCrossTalk makes); a since-relay that is refused records no mark.

- one candidate: act on it
- several: open the Talk menu, where every row now has send buttons too
- none: a short message on the cell

## After a send

The partner is brought forward through `gridSessionJump` (zoomed if the grid is zoomed, its page shown
otherwise) and takes the keyboard — the condition #574 moved to pull for: text must not land in a pane
the user is not looking at. Nothing is submitted.

## Not echoing the partner back

A prompt that is itself a pasted handoff (starts with `Another terminal (`) is reduced to what the
human typed after its last `--- end ---` line; if nothing, the prompt block is left out and only the
reply is sent. A clipped prompt with no end line is all relay. Applied in both formatters, so it holds
for bring as well. Pure rule in `server/session/transcript/relayed-prompt.ts`. The fingerprint still
hashes the raw prompt, so existing marks stay valid.

## Label

The origin line names the branch as well as the directory (`codex · feat/x · /path`), because a
partner in another worktree does not have the sender's files.

## Out of scope

Muse (#3375), auto-submit, exchange / round table, a default header button.
