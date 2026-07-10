# feat — live-reload `.mulmoterminal.json` without filesystem watchers

Issue: #302

## Problem

Editing `<cwd>/.mulmoterminal.json` does nothing until the browser reloads:

```ts
// src/composables/useDirConfig.ts
// ...the config is stable for the page's lifetime (changes to the file take
// effect on the next page load — MVP, no live watch).
const cache = new Map<string, Promise<DirConfig>>();
```

The `mulmoterminal-config` skill's colour loop is *apply → look at the real cell → adjust* (there is no
way to preview colour inside the conversation — Claude Code doesn't render ANSI, and a Bash child has
no controlling terminal). So the manual reload is the rate limiter of the whole flow.

## Why not `fs.watch`

Working directories are scattered across the disk, so a watcher can't be shared: one per open cwd.
Instead, make the **writer announce the change** — push, not poll.

## Design — zero watchers, no new endpoint

The server *already* sees every write. Claude's `PreToolUse`/`PostToolUse` hooks POST to `/api/hook`
with `tool_name` and `tool_input` (used today to build the per-session tool-call timeline, see
`handleToolHook` in `server/index.ts`). A write to `<dir>/.mulmoterminal.json` is therefore already
observable — no new machinery.

1. **`server/dir-config.ts`** — pure, testable helper:
   `dirConfigWriteTarget(toolName, toolInput): string | null` → the directory whose config a
   file-writing tool (`Write` / `Edit` / `MultiEdit`) just wrote, else null.
2. **`server/index.ts`** — in `handleToolHook`, on `PostToolUse` only (a `PostToolUseFailure` wrote
   nothing), publish `pubsub.publish("dir-config", { cwd })`.
3. **`src/composables/useDirConfig.ts`** — subscribe once to the `dir-config` channel; on a message
   drop that cwd from `cache`, refetch, and push the result into every live `config` ref bound to it.

Nothing else is needed on the client: `Terminal.vue` already re-applies the xterm palette via
`watch([themeId, () => props.dirTheme, () => props.dirColors], …)`, and the chrome colours are plain
reactive props.

## Preserved behaviour

- Channel naming follows the existing convention (plain literal, e.g. `"sessions"`), duplicated
  client-side like `useSessions` / `useAttentionSound` do.
- `useDirConfig` keeps its shape (`{ config }`), still dedupes one fetch per cwd across cells, and
  still ignores a stale resolve after a fast directory switch.
- Refs unregister on scope dispose, so a closed cell leaks nothing.

## Trade-off (accepted)

Only writes made through Claude's tools are detected; editing the file in vim will not live-reload.
That covers the skill flow completely, so an explicit `POST /api/dir-config/reload` is not worth the
extra surface. Revisit if hand-editing turns out to be common.

## Verification

- Unit: `dirConfigWriteTarget` — matching write tool + path, wrong tool, wrong filename, non-record
  input, relative path, `PostToolUseFailure` not published.
- Live: drive the app, change a directory's palette, and confirm the terminal recolours **without a
  reload** (read the xterm background via computed style).
