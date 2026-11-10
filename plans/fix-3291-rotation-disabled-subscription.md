# fix: token rotation keeps choosing a token whose subscription access is disabled (#3291)

## Problem

A rotation token whose organization has disabled Claude subscription access for Claude Code is
chosen for every new session. Its probe never answers, so the meter keeps the last reading it ever
got, and `chooseToken` ranks that reading by burn pace however old it is. A nearly unused week that
resets soon (and, after the reset, a week read as fully unused) outranks every real subscription.

Claude Code's own words, recorded from the TUI and `claude -p` (2.1.292):

> Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API
> key instead, or ask your admin to enable access

## Fix

1. **Name the refusal.** `classifyProbeStall` gains `subscription-disabled`, matched on the
   squashed "your organization has disabled claude subscription access". The token rotation runtime
   drops a token whose latest probe stalled on it from the candidates altogether — unlike a usage
   limit there is no reset to wait for, so it must not come back as "the one free soonest". A later
   probe that answers clears the stall, and the token returns by itself.
2. **Do not rank by a reading the latest probe could not confirm.** A candidate whose latest probe
   failed (`no-report`, any stall) is ranked with the unmeasured candidates, behind every measured
   one. Its last reading still decides the hold-outs (a week at its ceiling stays held out), so the
   demotion can only move it down. This covers refusals whose wording nobody has recorded yet.

Both decisions are pure (`token-choice.ts`, `token-assignment.ts`); the runtime only reads the
meters' probe state into them.

## Out of scope

- The usage gauge still shows the generic "no report" note for this token; a dedicated note would
  be a UI/i18n change of its own.
- The `/login` credential's probe state is not consulted (it is not metered by the rotation meters).
