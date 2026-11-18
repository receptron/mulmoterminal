# fix: write the folder-trust key with forward slashes on Windows (#3322)

## Problem

#3315 marks the drops root trusted in Claude Code's config so a cell handed its drop directory with
`--add-dir` is not stopped by the trust prompt. On Windows the key was written with `\`
(`C:\Users\<user>\AppData\Local\Temp\mulmoterminal-drops`), while Claude Code keys `projects` with
`/` (`C:/work/myproject`). It never looks the backslash key up, so the prompt kept appearing. The
reporter confirmed that adding the forward-slash key makes it stop.

The usage probe's folder (#3206) goes through the same writer and has the same defect.

## Fix

- `server/agents/claude/config-project-key.ts`: pure `claudeConfigProjectKey(path, separator)` —
  replaces `\` with `/` only when `\` is the separator, so a POSIX filename containing `\` is untouched.
- `ensureFolderTrusted` (the one place both callers write through) keys the entry with it.
- The two specs that read the entry back (drops trust, rate-limit probe) look it up under the same
  key, so on the Windows CI leg they now assert the forward-slash spelling rather than our old output.

## Left out

- The backslash entry an earlier version wrote stays in the user's config. It is inert (Claude Code
  never reads it) and removing it would mean deleting a key from a file we do not own.
- `server/blueprint/trust.ts` only READS keys and already resolves both spellings.
