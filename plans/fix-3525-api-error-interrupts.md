# fix: an API error stops a skill evaluation (#3525)

## Problem

With the `claude` CLI's login expired, every attempt ended at once with "Failed to authenticate" and
was counted as a failed attempt. The run finished `done`, so it became the baseline: the mark, the next
step and Improve all read "this skill fails everything".

## Observed

`claude -p` (stream-json and json) prints a result line with `is_error: true`, the message as `result`,
and `terminal_reason: "api_error"`.

## Change

- `streamOutcome` reads `apiError` from `terminal_reason: "api_error"` (`apiErrorOf`); `judgeApiError`
  reads the same from the grader's JSON.
- `runAttempt` throws on either. The existing worker failure path then ends the run `interrupted` with
  the message as `interruptedBy`; an interrupted run is not a baseline, and the panel already shows the
  reason.
- The improvement writer treats `apiError` as a failure too, even when the line is not `is_error`, so an
  edit it left behind is never measured.
- A timeout or an exhausted budget stays a failed attempt: those are the task not finishing.

## Left out

`claude` not installed (spawn failure) ends the same way as before; it was not observed here.
