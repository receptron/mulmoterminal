// By-path file access for presentDocument / presentHtml's `path` argument — ANY
// `.md` / `.html` on disk (workspace-relative or absolute), not just the ones those
// tools wrote into `artifacts/`.
//
// The rules — what a `path` may be, how it resolves, why `write` refuses to CREATE,
// why a symlink is written through to its target, and why there is deliberately no
// containment root — all live in `@mulmoclaude/core/files` (`byPath.ts`), shared with
// MulmoClaude so one tool call cannot mean two different things in the two apps
// (MulmoClaude's counterpart is `server/utils/files/by-path.ts`). This file only
// supplies the root and the workspace realpath.
//
// NOT `backends/fileOps.ts`. That one exists to CONFINE a plugin to one directory;
// this one deliberately does not confine. Opposite purposes — don't reach for the
// wrong one.
//
// The root below is the WORKSPACE, and it stays that way: a tool call's relative `path`
// has already been made absolute at the dispatch route, against the calling session's
// own directory (backends/presentPathRoot.ts). Don't reinvent that as a per-request root
// here — the View's dispatch and the /htmlfile iframe request come from the browser and
// can name no session, so they would fall back to the workspace and disagree with the
// tool call that opened them.
import { realpath } from "node:fs/promises";
import { createByPathFileOps, resolveHtmlFileRequestPath, HTML_EXTENSIONS, MARKDOWN_EXTENSIONS } from "@mulmoclaude/core/files";
import type { FileOps } from "gui-chat-protocol";

// Injected at boot (server/index.ts), like the artifacts backend: the ops below are
// bound into the plugin registry's closures at import time, so the root is read PER
// CALL rather than captured here.
let workspace: string | null = null;

export function initOpenPathBackend(deps: { workspace: string }): void {
  workspace = deps.workspace;
}

function rootFor(): string {
  if (!workspace) throw new Error("open-path backend not initialised (missing workspace)");
  return workspace;
}

// `satisfies`, not `as`: core declares its own structural echo of the protocol's
// FileOps (it keeps no dependency on gui-chat-protocol), and these are independently
// versioned packages. A cast would go quiet the day the two shapes drift; this makes
// the compiler check the conformance while keeping the inferred type.
/** `files.byPath` for presentDocument — reads/overwrites any `.md` the tool named. */
export const markdownByPath = createByPathFileOps({ rootFor, extensions: MARKDOWN_EXTENSIONS }) satisfies FileOps;

/** `files.byPath` for presentHtml — reads/overwrites any `.html`/`.htm`. */
export const htmlByPath = createByPathFileOps({ rootFor, extensions: HTML_EXTENSIONS }) satisfies FileOps;

// The `/htmlfile` resolver wants a realpath'd root (a symlinked workspace would
// otherwise resolve to a path the serving stat can't match). Cached — the workspace
// doesn't move while the server runs — and falling back to the lexical path keeps the
// mount working if realpath fails (a missing workspace 404s at the stat anyway).
let workspaceRealCache: Promise<string> | null = null;

function workspaceReal(): Promise<string> {
  const root = rootFor();
  workspaceRealCache ??= realpath(root).catch(() => root);
  return workspaceRealCache;
}

/** Absolute on-disk path for a `/htmlfile/<scope>/<segments…>` request, or null when
 *  the URL is malformed / out of scope / touches a `.`, `..` or dotfile segment.
 *  All of that judgement is core's — see the "don't split the URL yourself" note at
 *  the route in `backends/html.ts`. */
export async function resolveHtmlRequest(reqPath: string): Promise<string | null> {
  return resolveHtmlFileRequestPath(await workspaceReal(), reqPath);
}

/** Test-only: drop the cached workspace realpath so a spec can re-init with a new dir. */
export function resetOpenPathBackend(): void {
  workspace = null;
  workspaceRealCache = null;
}
