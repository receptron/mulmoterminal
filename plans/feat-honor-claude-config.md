# feat: honor user/project Claude Code config (drop --strict-mcp-config) (#44)

## Direction

"mulmo GUI layer (presentDocument/presentForm/generateImage/…) + a real Claude
Code dev terminal." Reflect the user's `~/.claude/` config and the launched dir's
`<dir>/.claude` / `<dir>/.mcp.json`.

## Change

- Remove `--strict-mcp-config` from the spawn args. `--mcp-config` is additive, so:
  - the **GUI MCP (`mulmoterminal-gui`) stays**, AND
  - claude also loads the user MCP (`~/.claude.json`) + project MCP (`<cwd>/.mcp.json`).
- `--permission-mode auto` kept (per decision); `CLAUDE_PERMISSION_MODE` still overrides.
- Skills already honored (`~/.claude/skills` + `<cwd>/.claude/skills`, cwd-scoped) — no change.

## Verify in a real environment

- `--settings` (our hooks) merges with `~/.claude/settings.json` / `<dir>/.claude/settings.json`
  (the user's hooks/permissions/env also apply).
- project `.mcp.json` trust-prompt works in the interactive terminal; GUI + user/project MCP coexist.

## Note

- MCP servers in `~/mulmoclaude/config/mcp.json` are NOT picked up (that's a MulmoClaude
  path). Move them to `~/.claude.json` (user) or `<dir>/.mcp.json` (project).

## Verified (automated)

- spawn no longer passes `--strict-mcp-config`; a session still spawns + streams (WS smoke).
- `lint` / `typecheck:server` / `test` (29) / `build` green. GUI tools still registered (`/api/tools`).

Bumps to 0.1.5 (also ships #42's GUI-store relocation, previously unpublished).
