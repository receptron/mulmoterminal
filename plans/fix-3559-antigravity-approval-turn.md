# fix: an Antigravity artifact approval opens its own turn (#3559)

## Problem

Approving a plan in Antigravity's UI writes a `USER_INPUT` step whose `<USER_REQUEST>` is empty.
agy states the action outside the wrapper ("Comments on artifact URI: …", "The user has approved
this document."). `antigravityPromptText` returned only the inside of the wrapper, so:

- the conversation view (`antigravityTurnPrompt`) opened no turn: the approval was not shown, and
  the work after it was folded into the turn that asked for the plan;
- the last-turn reader did end the previous exchange at that step, since it splits on every
  `USER_INPUT`, but with a null prompt, so a handoff or the finished-turn push quoted the reply with
  no question.

## The rule

`antigravityPromptText` (moved to `server/agents/antigravity/antigravity-prompt-text.ts`, pure):

- a wrapper with text in it → that text, as before;
- otherwise → the content with the wrapper and agy's appended blocks removed. That covers the
  approval (the wrapper is empty) and a step with no wrapper (as before).

All three readers go through it: the title, the view's turn prompt and the last-turn prompt.

## Left out

- A step carrying both a comment outside the wrapper and text inside it has not been seen. It
  keeps the text inside, as before.
- The approval is shown as agy wrote it, file URI included. It is not shortened to a file name,
  because that would mean parsing a format seen exactly once.
