# fix: html-plan stops when `presentHtml` is missing (#3541)

## Problem

In a project-folder cell with Canvas off, `/mulmoterminal-html-plan` ran anyway. The agent reached
for the server's `/api/mcp/<sessionId>` directly and opened the page in a separate browser; the page
never reached the pane, and the user's Send from that browser never reached the terminal.

## Change

`server/skills/mulmoterminal-html-plan/SKILL.md` gets a step 0: check for `presentHtml` first; without
it, stop and tell the user to switch on Canvas for the folder and use the cell menu's "Restart the agent" (reopening the cell reattaches to the agent that lacks the tool). It also names the
workarounds (calling `/api/mcp/…`, writing a file, opening a browser) as not to be tried, since none of
them delivers the Send back.

Wording follows the precondition `mulmoterminal-data-analysis` already states for the same toggle; that skill gets the same "Restart the agent" instruction.

## Out of scope

Enforcing this in code (e.g. hiding the skill when the render group is off). The skill is mirrored
globally, so it cannot know per cell whether the tool is present; the agent's own tool list can.
