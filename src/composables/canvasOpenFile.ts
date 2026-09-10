// Open a file the user picked in the Canvas, without asking the agent for it (#1374).
//
// The Canvas renders a session's TOOL RESULTS, so the way in is to write one: a synthetic result
// standing in for the tool call nobody made. `presentCollection` has done exactly this since #1768
// — see seedCollectionCanvas.ts, which this mirrors, including POSTing to the same route so the
// card survives a reload and the agent's own card supersedes it.
//
// Which files qualify is decided by each PLUGIN rather than by an extension test here. A second
// opinion in this file could only be a weaker one that reports success for a file that never
// renders. How that decision is reached differs per tool, and the difference is the shape of this
// module:
//
//   markdown, html   a lexical guard their executors already run (`isDocumentPath` refuses a
//                    prefixed traversal; `isPresentableHtmlPath` refuses a dotfile the iframe
//                    mount would deny). The card carries a path and the View self-fetches.
//   mulmoScript      the card needs the parsed script rather than a path, so the card comes from
//                    the plugin's own reopen. See storyWirePath / reopenStory. (Absolute paths
//                    WERE refused outright, through plugin 4.5.2; 4.6.0 added the `byPath` form
//                    and this host opts into it — server/backends/mulmoscript.ts. Reading the old
//                    sentence as still true is what kept a repository deck on the rooted wire
//                    path, which is #1970.)
import { TOOL_NAME as DOCUMENT_TOOL, isDocumentPath } from "@mulmoclaude/markdown-plugin/vue";
import { TOOL_NAME as HTML_TOOL, isPresentableHtmlPath, isHtmlArtifactPath, htmlArtifactPreviewUrl, htmlFileUrl } from "@mulmoclaude/html-plugin";
import { TOOL_NAME as STORY_TOOL } from "@mulmoclaude/mulmoscript-plugin";
import { dirPathKey, isRootedPath } from "../../common/dirPathKey";
// The wire spelling is minted here and parsed back into a path there — one pair of constants, so a
// card's identity cannot come to disagree with the ref that opened it.
import { STORY_DIR, STORY_WIRE_PREFIX } from "../utils/canvasCardPath";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

export interface CanvasCard {
  toolName: string;
  data: Record<string, unknown>;
}

/** What asking for a card ended in.
 *
 *  Three outcomes, not one nullable card: `none` and `refused` used to collapse into `null`, and
 *  the caller then had nothing to say — a click that the server had answered with a sentence
 *  looked exactly like a click on a file nothing renders (#1941).
 *
 *  `none` stays silent on purpose: nothing offers the action for such a file, so it cannot be
 *  clicked. `refused` carries what the server said, which is already a sentence about what to do. */
export type CanvasCardResult = { kind: "card"; card: CanvasCard } | { kind: "refused"; reason: string } | { kind: "none" };

/** One directory the plugin serves stories from, as this server registered it.
 *
 *  `id` is never re-derived in the browser: a card carries it, and a rule that drifted from the
 *  server's would mint cards naming a root nothing registered. */
export interface StoriesRoot {
  id: string;
  /** Every spelling this directory is known by — the one the user launched with AND the resolved
   *  one, because BOTH reach the Files pane. A cell opened from the launcher carries the spelling
   *  the user typed; one opened in a git worktree carries the realpathed spelling `git worktree
   *  list` reports. `dirPathKey` is lexical (a browser cannot realpath), so a gate that knew only
   *  one of them hid the Canvas entry for every deck under the other (Codex P1 iter-5 on #1934).
   *
   *  Only a GATE: the server re-checks containment with a realpath when the card is built, so a
   *  spelling accepted here that names something else still opens nothing. */
  paths: readonly string[];
}

/** Where stories can live, as this server serves them.
 *
 *  MANY roots since #1951 — the workspace plus every directory the user launches in — because a
 *  deck kept in an ordinary repository was found and correctly refused while only the workspace
 *  was registered. Empty reads as "only the workspace's own stories directory", i.e. exactly the
 *  pre-#1933 behaviour, which is also what the browser has before `/api/config` arrives. */
export interface StoriesRoots {
  /** The WORKSPACE's spellings. Kept apart from `roots` because its own `artifacts/stories` is
   *  addressed WITHOUT a root — the plugin's default — and that rule has to win. */
  workspaces: readonly string[];
  roots: readonly StoriesRoot[];
}

/** The browser's view of what the server registered. The FIRST entry is the workspace — the server
 *  registers it first — and its own `artifacts/stories` is the one place addressed without a root.
 *  One derivation, so the Files pane, the Mulmo menu and the grid cannot disagree about which
 *  directory that is (#1951). */
export const storiesRootsFrom = (registered: ReadonlyArray<{ id: string; paths: readonly string[] }>): StoriesRoots => ({
  workspaces: registered[0]?.paths ?? [],
  roots: registered.map((root) => ({ id: root.id, paths: root.paths })),
});

/** A story as the wire addresses it: the path, plus which root it is relative to (absent = the
 *  workspace's own `artifacts/stories`, the only one before #1933). */
export interface StoryRef {
  filePath: string;
  root?: string;
}

/**
 * The Canvas card that renders `path`, or null when no plugin here can show it.
 *
 * Pure: no network, no DOM. The caller seeds it.
 */
export function canvasCardForFile(path: string): CanvasCard | null {
  if (isDocumentPath(path)) {
    // `markdown` is required on MarkdownToolData, and empty is right rather than a placeholder:
    // `documentPathOf` reads `docPath` authoritatively, so nothing mistakes "" for a one-line body.
    return { toolName: DOCUMENT_TOOL, data: { markdown: "", docPath: path } };
  }
  if (isPresentableHtmlPath(path)) {
    // The host supplies `previewUrl` — the package cannot know how we serve a page. Leaving it out
    // makes the View derive `/artifacts/html/…`, which is right only for a page that lives there.
    // The Files pane is rooted at the CELL's cwd, so most html a user opens is somewhere else, and
    // the derived URL would point at nothing. `/htmlfile/…` is the mount that serves those
    // (server/backends/html.ts), with the same guards and CSP.
    const previewUrl = isHtmlArtifactPath(path) ? htmlArtifactPreviewUrl(path) : htmlFileUrl(path);
    return { toolName: HTML_TOOL, data: { filePath: path, ...(previewUrl ? { previewUrl } : {}) } };
  }
  return null;
}

/**
 * The path to put on a card, from the Files pane's `cwd` + its row's relative path.
 *
 * The pane is rooted at the CELL's directory, while the plugins' file layer is rooted at the
 * WORKSPACE — so a bare `design.md` from a project cell resolves to a file in the workspace that
 * does not exist, and the View renders nothing (found by opening one in a real browser; nothing
 * failed, the card was simply empty). An absolute path is what both gates accept and what
 * `htmlFileUrl` turns into its `/htmlfile/abs/…` scope.
 *
 * Joined with `/` on every platform: both gates accept a Windows path with either separator, and
 * `htmlFileUrl` normalises a mixed one — verified against `C:\\Users\\me\\proj/docs/design.md`.
 */
export function absoluteUnder(cwd: string | null, relative: string): string {
  if (!cwd) return relative;
  // Sliced rather than matched: a trailing-separator regex with a quantifier backtracks, and one
  // separator is the only case a directory path actually produces.
  const base = cwd.endsWith("/") || cwd.endsWith("\\") ? cwd.slice(0, -1) : cwd;
  return `${base}/${relative}`;
}

/**
 * The wire path a mulmoScript card carries for `absolutePath`, or null when it is not a `.json`.
 *
 * Where markdown and html are asked "can you render this file", this asks WHERE the file is, and
 * answers with the spelling the plugin wants for that place. Two cases, in this order:
 *
 *   1. under the workspace's own `artifacts/stories/` — `stories/<tail>`, no root. That IS the
 *      plugin's default root, so a dispatch carrying no root still resolves it.
 *   2. anywhere else — the file's own absolute path (the `byPath` form the plugin has taken since
 *      4.6.0, which this host opts into; see server/backends/mulmoscript.ts).
 *
 * A REGISTERED ROOT used to be its own case between those two, answering `stories/<tail>` plus the
 * root's id, and that was #1970. The reopen carries a root, so the deck OPENED — but the View's own
 * dispatches (`updateScript`, `updateBeat`, `beatImage`, the movie/PDF polls) pass `filePath`
 * through and send no root, so every one of them resolved the tail against the DEFAULT root and
 * answered `File not found`. A deck kept in a repository showed a red error on each beat and failed
 * to save in silence. An absolute path cannot lose a root, because it has none.
 *
 * Case 1 stays relative because it is already right under a root-less dispatch, and it is decided
 * FIRST because the default stories directory sits inside the workspace's own subtree — one file
 * reachable both ways must mint one spelling, not two.
 *
 * Identity is unharmed by any of this: `canonicalCardPath` resolves all three to the same absolute
 * path (utils/canvasCardPath.ts), so an agent's `stories/…` card and a pane-minted one collapse
 * onto one card.
 *
 * Until #1976 the absolute case answered null, and a deck outside every root had no Canvas entry at
 * all: the plugin would have opened it, but the card's identity was the wire string, so the same
 * deck reached two ways became two cards. A button that is not offered was the lesser evil until an
 * identity that survives both spellings existed.
 *
 * `.json` is the whole test for the absolute case, deliberately: whether the file is really a
 * MulmoScript is the plugin's decision (it answers `File is not a valid MulmoScript`, which the
 * pane shows), and a second opinion here could only be a weaker one. Note this widens nothing for a
 * workspace-rooted tree — every `.json` under a registered root already qualified.
 *
 * Lexical, on the same key the workspace chip compares with: a browser cannot resolve a symlink,
 * and `..` folds away here, so a traversal simply fails to match the prefix. Nothing rests on it —
 * the reopen below runs the plugin's own guard and a realpath check server-side, so a path this
 * lets through still yields no card.
 */
export function storyWirePath(absolutePath: string, roots: StoriesRoots): StoryRef | null {
  const { workspaces } = roots;
  const key = dirPathKey(absolutePath);
  if (!key.endsWith(".json")) return null;
  // ONE rule for what "under this directory" means, because two goes wrong twice: `dirPathKey`
  // TRIMS its input (a trailing space in the last component is eaten — Codex P2) and answers a root
  // directory as `/`, `C:/` or `//server/share`, which already carry the separator (Codex P1). So a
  // prefix is keyed from a spelling that always ENDS in one — the trailing separator protects the
  // space, and the key that comes back is normalised into exactly one.
  const endsWithSeparator = (dir: string): boolean => /[/\\]$/.test(dir);
  const joinPath = (dir: string, rel: string): string => (endsWithSeparator(dir) ? `${dir}${rel}` : `${dir}/${rel}`);
  const prefixOf = (dir: string): string => {
    const keyed = dirPathKey(endsWithSeparator(dir) ? dir : `${dir}/`);
    return keyed === "" || keyed.endsWith("/") ? keyed : `${keyed}/`;
  };
  const under = (prefix: string): string | null => (prefix !== "" && key.startsWith(prefix) ? key.slice(prefix.length) : null);
  /** The first spelling that contains the file, as its relative tail. The tail is the same
   *  whichever spelling matched — they name one directory. */
  const underAny = (dirs: readonly string[], dirOf: (dir: string) => string): string | null => {
    for (const dir of dirs) {
      const tail = under(prefixOf(dirOf(dir)));
      if (tail) return tail;
    }
    return null;
  };
  // The workspace's own stories directory FIRST, and it answers without a root. It sits INSIDE the
  // workspace root's subtree, so both could name the same file — as `stories/x.json` and as
  // `stories/artifacts/stories/x.json` — and the two spellings are two identities, hence two cards
  // for one deck. Deciding the narrower one first means only one spelling is ever minted.
  const inDefault = underAny(workspaces, (workspace) => joinPath(workspace, STORY_DIR));
  if (inDefault) return { filePath: `${STORY_WIRE_PREFIX}${inDefault}` };
  // ANYWHERE ELSE: the file's own absolute path, whether or not a registered root contains it.
  //
  // A registered root used to answer `stories/<tail>` plus the root's id here, and that is what
  // #1970 was: opening worked, because the reopen carries the root — but the View's own dispatches
  // (`updateScript`, `updateBeat`, `beatImage`, the movie/PDF status polls) pass `filePath` through
  // and send NO root, so every one of them resolved the tail against the DEFAULT stories root and
  // answered `File not found`. A deck in a repository opened, showed a red error on every beat, and
  // silently failed to save. Measured against a running server: the wire form 404s on
  // `updateScript` where the absolute form writes the file.
  //
  // An absolute path cannot lose a root because it does not have one, so it survives a dispatch
  // that forgets to carry it. That is the same reason the deck-outside-every-root case already used
  // it (#1976); this only stops treating a registered root as the exception. Identity is unharmed —
  // `canonicalCardPath` resolves both spellings to the same absolute path, so an agent's
  // `stories/…` card and this one still collapse into one.
  //
  // As the pane spelled it rather than as `key`: `dirPathKey` TRIMS, so a name ending in a space
  // would name a different file, and the server is handed this same string as `expectPath` to
  // compare its realpath against. A `.` or `..` segment the plugin refuses is the one thing the key
  // would have folded, and neither the tree's rows nor a cell's cwd produces one.
  // Not a path this server can place: the pane falls back to the row's RELATIVE spelling when it
  // has no cwd (`absoluteUnder`), and a relative `filePath` is not "the file over there" — it is
  // the default stories root's own `design.json`. Measured: every relative input answers null here,
  // through the default-stories branch above as well, so there is no reachable case left in which a
  // registered root could offer a spelling this does not.
  return isRootedPath(absolutePath) ? { filePath: absolutePath } : null;
}

/**
 * Whether the Canvas can show `path` at all — what the Files pane's button is shown on.
 *
 * `workspace` is only consulted for stories; markdown and html are judged wherever they live.
 */
export const canOpenInCanvas = (path: string | null, roots: StoriesRoots = { workspaces: [], roots: [] }): boolean =>
  path !== null && (canvasCardForFile(path) !== null || storyWirePath(path, roots) !== null);

/**
 * Longer than the shared default because the reopen reads and schema-completes a whole script,
 * and it BLOCKS the Canvas from opening — giving up early here shows the user nothing, which they
 * cannot tell apart from "this file cannot be shown".
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** When the reopen fails and the server said nothing usable. Reaching the reopen means the action
 *  WAS offered and the user clicked it, so there is no outcome here that may be silent — an empty
 *  body, a proxy's error page, a shape nobody recognises all have to say something (Codex on
 *  #1942). Only `buildCanvasCard` answers `none`, for a file nothing offers the action on. */
const REOPEN_FAILED_EN = "could not open this deck — the server did not say why";

/**
 * The mulmoScript card for `wirePath`, built by the plugin's own reopen rather than here.
 *
 * `MulmoScriptData` requires the parsed `script`, not just a path — unlike markdown and html,
 * whose Views self-fetch — and reading and validating it in the browser would be a second copy of
 * logic this route already runs. What comes back is what the agent's own tool call produces,
 * including the normalized `filePath` that `filePathIdentity` collapses the two cards on.
 *
 * A refusal can arrive under EITHER status, so the body is what has to be read: the realpath
 * mismatch is a 400, an unknown root or a missing file is a 200 carrying `{ok:false, error}`, and a
 * proxy in between can answer neither shape. Measured, and pinned in
 * `test/server/backends/mulmoscript-expect-path.spec.ts`. Do not simplify this to a status check —
 * on a 200 that would drop the sentence, and on a 4xx it would drop the only sentence there is
 * (CodeRabbit on #1942; an older version of this comment described a `data` envelope that the
 * dispatch does not use at all).
 */
async function reopenStory(ref: StoryRef, expectPath: string): Promise<CanvasCardResult> {
  try {
    const res = await fetchWithTimeout(
      "/api/plugin/presentMulmoScript",
      // `kind: "save"` with a `filePath` and no `script` is the package's REOPEN — and it is the
      // only shape that carries a root. The kind-less body is the AGENT's tool call, which is
      // deliberately root-blind: `root` is not in the tool schema, so a model cannot name one
      // (receptron/mulmoclaude#3015). A browser asking for a deck it can see is not that caller.
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "save", ...ref, expectPath }) },
      REQUEST_TIMEOUT_MS,
    );
    const body: unknown = await res.json().catch(() => null);
    // The sentence the server wrote, which is the whole reason to read the body rather than log a
    // status. The status does NOT tell the two kinds of refusal apart: the realpath mismatch is a
    // 400, an unknown root is a 200 carrying `{ok:false, error}` — both measured, and pinned in
    // `test/server/backends/mulmoscript-expect-path.spec.ts`. Hence a refusal is read off the body
    // on both branches below.
    //
    // Blank counts as ABSENT, not as a sentence: `??` only catches null, so an `error: ""` from any
    // layer between us and the plugin would survive to `showError`, where the pane renders it under
    // `v-if="fileError"` — i.e. nothing at all, which is the dead button this whole change removes
    // (CodeRabbit on #1942).
    const refusal = isRecord(body) && typeof body.error === "string" && body.error.trim() !== "" ? body.error : null;
    if (!res.ok) {
      console.error(`[canvasOpenFile] reopen HTTP ${res.status}`);
      return { kind: "refused", reason: refusal ?? REOPEN_FAILED_EN };
    }
    // The dispatch answers FLAT — `{ok, script, filePath, root}` — where the agent's kind-less tool
    // call answers an envelope `{data}`. Measured, and the difference is not cosmetic: reading
    // `body.data` here built no card at all, so the row's menu entry appeared and clicking it did
    // nothing. The card is assembled from the fields the View needs (`script` + `filePath`, the
    // shape the tool path's `data` has), plus the root the response echoes — which is what keeps
    // two roots' identically-named decks on two cards (canvasIdentity.filePathIdentity).
    // Measured against the running server: a missing story answers HTTP 200 with
    // `{ok:false, code:"not_found", error:"File not found: …"}` — a shape that carries its own
    // sentence. Anything else that is not a card falls back rather than going quiet.
    if (!isRecord(body) || body.ok !== true || !isRecord(body.script) || typeof body.filePath !== "string") {
      return { kind: "refused", reason: refusal ?? REOPEN_FAILED_EN };
    }
    const root = typeof body.root === "string" ? { root: body.root } : {};
    return { kind: "card", card: { toolName: STORY_TOOL, data: { script: body.script, filePath: body.filePath, ...root } } };
  } catch (err) {
    console.error("[canvasOpenFile] reopen failed", err);
    return { kind: "refused", reason: "could not reach this server to open the deck" };
  }
}

/**
 * The card to seed for `absolutePath`, or null when nothing here can show it.
 *
 * The async half of {@link canvasCardForFile}: markdown and html are decided in memory, and only a
 * story needs the round trip. Callers use THIS and {@link canOpenInCanvas} with the same arguments
 * — a button gated on one path while the card is built from another is a button that does nothing.
 */
export async function buildCanvasCard(absolutePath: string, roots: StoriesRoots): Promise<CanvasCardResult> {
  const direct = canvasCardForFile(absolutePath);
  if (direct) return { kind: "card", card: direct };
  const ref = storyWirePath(absolutePath, roots);
  // The absolute path travels with the wire path so the SERVER can check the two still name one
  // file. This gate is lexical and cannot realpath; the workspace it compares against was resolved
  // at boot, so the two can part company while the server runs (#1934). Sending what the pane
  // actually showed turns "a different deck opens" into a refusal with a sentence.
  return ref ? await reopenStory(ref, absolutePath) : { kind: "none" };
}

/**
 * Write `card` into `sessionId`'s Canvas feed.
 *
 * The same route the agent's own results take, so the card is stored, replayed on reload, and
 * collapsed against the agent's card for the same file by `collapseByIdentity` — no reconciliation
 * of our own. Returns whether it landed; the caller reveals the Canvas only if it did, because
 * enlarging a cell to show nothing is worse than not enlarging it.
 */
export async function seedCanvasCard(sessionId: string, card: CanvasCard): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      "/api/agent/toolResult",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uuid: crypto.randomUUID(), ...card, sessionId }) },
      REQUEST_TIMEOUT_MS,
    );
    if (res.ok) return true;
    console.error(`[canvasOpenFile] HTTP ${res.status}`);
  } catch (err) {
    console.error("[canvasOpenFile] failed", err);
  }
  return false;
}

/**
 * Whether `sessionId` already has any Canvas card stored.
 *
 * Asked so a session that has something to show can open the pane even without the render MCP
 * (#1374). There is no count endpoint — this is the same list the panel fetches when it opens, and
 * the cost is accepted rather than hidden. A failure answers "no", which only means the button
 * falls back to what the tools said, as it did before.
 */
export async function hasStoredCard(sessionId: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`/api/agent/toolResults/${encodeURIComponent(sessionId)}`, undefined, REQUEST_TIMEOUT_MS);
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return isRecord(body) && Array.isArray(body.toolResults) && body.toolResults.length > 0;
  } catch {
    return false;
  }
}
