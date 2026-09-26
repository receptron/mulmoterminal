// Project-scoped file browsing + editing for the full-screen Files view. Takes a
// `?cwd=` project dir (the directory a terminal's session runs in) so each terminal
// browses/edits ITS OWN project. list/text/md are read-only GETs; write is a PUT.
//
// Security: the same loopback/trusted-local-user posture as the worktree/session
// endpoints — any absolute existing dir is an allowed base — but `path` is always
// contained within that base (no `..`/absolute escape), for reads AND writes. Rendered
// markdown is served under a sandbox CSP so embedded scripts can't run in the app origin.
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { Marked, type Token, type Tokens } from "marked";
import type { Express, Request, Response } from "express";
import os from "node:os";
import { hasErrnoCode } from "../errors.js";
import { backupCurrentFile, storeBackup } from "./backup-store.js";
import { losslessText } from "./editableText.js";
import { containedPath, expandTilde, resolveBase, resolveContained } from "./pathContainment.js";
import { servedImageSrc, type ServedDoc } from "./mdImageSrc.js";
import { listProjectFiles } from "./project-files.js";
import { answered, modeFromProbe, parseSearchOutput, searchArgv, SEARCH_TIMEOUT_MS } from "./file-search.js";
import { CONTEXT_RADIUS_LINES, isSearchable, lineWindow, type SearchRequest, type SearchResult } from "../../common/fileSearch.js";
import { git } from "../git/worktrees.js";
import { htmlDoc, jsonHtmlDoc, tableHtmlDoc, delimiterForExtension, themeStyle } from "./renderedDoc.js";
import { previewThemeFromQuery, type PreviewTheme } from "../../common/previewTheme.js";
import { mdPreviewEmbedCsp, mdPreviewReporterTag, newPreviewNonce, wantsMdPreviewEmbed } from "./mdPreviewEmbed.js";
import { MD_PREVIEW_EMBED_PARAM } from "../../common/mdPreviewMessage.js";
import { requestBody } from "../routes/requestBody.js";
import { splitFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

// Cap on the bytes served to the editor / accepted on write — a text editor, not a
// blob store. Large/binary files are refused rather than streamed into a textarea.
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/** Wrap marked's HTML output in the shared self-contained document (served sandboxed). */
export const mdToHtmlDoc = (bodyHtml: string, title: string): string => htmlDoc(bodyHtml, title);

export interface BrowseEntry {
  name: string;
  dir: boolean;
  size: number;
}

// A file's version token, handed to the editor with its text and handed back on save so a
// write that would clobber someone else's is refused instead (the agent running in that very
// directory is the someone else). Content, not mtime: a one-second-resolution filesystem or
// two writes inside a clock tick report "unchanged" for exactly the race this guards.
// Computed from raw bytes and never by the client, so a BOM or invalid UTF-8 can't make the
// two sides disagree about what the file is.
const versionOfBytes = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** The file's current version, or null when it doesn't exist — which is also what a caller
 *  passes as `baseVersion` to say "I expect to be creating this". ONLY a missing file reads
 *  as null: one that exists but can't be read (permissions, a transient I/O error) must not
 *  answer "absent", or a `baseVersion: null` write would sail past the conflict check and
 *  overwrite it. Anything else throws, and the write fails instead of guessing. */
export function currentVersion(abs: string): string | null {
  try {
    return versionOfBytes(fs.readFileSync(abs));
  } catch (err) {
    if (hasErrnoCode(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

// Directory listing, directories first then files, each alphabetical. Dotfiles are
// kept (a project's config often lives in them) but node_modules/.git are noisy —
// still listed; the UI can collapse them.
export function listEntries(absDir: string): BrowseEntry[] {
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .map((d) => {
      const dir = d.isDirectory();
      let size = 0;
      if (!dir) {
        try {
          size = fs.statSync(path.join(absDir, d.name)).size;
        } catch {
          size = 0;
        }
      }
      return { name: d.name, dir, size };
    })
    .sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1; // directories first
      return a.name.localeCompare(b.name);
    });
}

// Project base + relative path from a browse request's query. browseBase falls back to
// the server's default cwd; browseRel defaults to "" (the base itself).
const browseBase = (req: Request, defaultCwd: string): string =>
  resolveBase(typeof req.query.cwd === "string" ? req.query.cwd : null, defaultCwd, os.homedir());
const browseRel = (req: Request): string => (typeof req.query.path === "string" ? req.query.path : "");

// Resolve `path` under the request's project base; 403 (and returns null) if it escapes —
// lexically OR through a symlink. One containment gate shared by every route (read + write).
function containedFor(req: Request, res: Response, defaultCwd: string): string | null {
  const abs = resolveContained(browseBase(req, defaultCwd), browseRel(req), os.homedir());
  if (!abs) {
    res.status(403).json({ error: "path escapes the project root" });
    return null;
  }
  return abs;
}

type RenderDoc = (text: string, title: string, doc: ServedDoc) => string | Promise<string>;

/** The same document for a host that will embed it, carrying the nonce the one permitted script
 *  has to declare. A route that has no reason to be embedded does not define one. */
type EmbedDoc = (text: string, title: string, nonce: string, doc: ServedDoc, theme: PreviewTheme | null) => string | Promise<string>;

/** Where the served document sits, measured LEXICALLY from the request rather than from the real
 *  path: a browser resolves a relative `src` against where the document appears to be, and a
 *  symlinked document appears where the link is. */
function servedDoc(req: Request, defaultCwd: string): ServedDoc {
  const base = browseBase(req, defaultCwd);
  const lexical = containedPath(base, expandTilde(browseRel(req), os.homedir())) ?? path.resolve(base);
  const dirRel = path.relative(path.resolve(base), path.dirname(lexical)).split(path.sep).join("/");
  return { base, dirRel };
}

// The file's text, or null with the response already answered. Shared by the rendered views
// so "directory / too large / missing" reads the same from every one of them.
function readTextOr4xx(res: Response, abs: string): string | null {
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      res.status(400).json({ error: "not a file" });
      return null;
    }
    // The same cap as /text and /write: a huge file must not be read and parsed into memory.
    if (stat.size > MAX_EDIT_BYTES) {
      res.status(413).json({ error: "file too large" });
      return null;
    }
    // Same rule as /text: a file whose bytes do not survive UTF-8 is not something to render as
    // a document either, and reading it here with "utf8" would put the same replaced content on
    // screen. Refused at the source so neither surface has to recognise mojibake (#2038).
    const text = losslessText(fs.readFileSync(abs));
    if (text === null) {
      res.status(415).json({ error: "this file cannot be shown as text", kind: "binary" });
      return null;
    }
    return text;
  } catch {
    res.status(404).json({ error: "not found" });
    return null;
  }
}

// A rendered view (#808): read the file the same guarded way, answer with a self-contained
// document under the sandbox CSP. Only the rendering differs between routes, so that is all
// the caller supplies.
//
// `embed` is the Files pane asking for the same document with the scroll reporter in it (#2157),
// and a route without one simply ignores `?embed=1`. It is opt-in per route and per request so
// that the document every OTHER caller gets — the new tab a clicked `.md` in terminal output
// opens — keeps the policy it has always had, byte for byte.
function mountRenderedRoute(app: Express, routePath: string, defaultCwd: string, render: RenderDoc, embed?: EmbedDoc): void {
  app.get(routePath, async (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const text = readTextOr4xx(res, abs);
    if (text === null) return;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const title = path.basename(abs);
    const doc = servedDoc(req, defaultCwd);
    if (embed && wantsMdPreviewEmbed(req.query[MD_PREVIEW_EMBED_PARAM])) {
      // One nonce per response, never reused and never derived from anything in the file: it is
      // what separates the one script this server wrote from every script the file contains.
      //
      // Which is also why this response must never become one a 304 can answer. Express derives
      // its ETag from the body, and the body carries the nonce — so a conditional request always
      // misses and comes back with a header and a body that agree. Giving this route a
      // `Last-Modified` or a `Cache-Control` would break that: a 304 sends the NEW header over
      // the browser's OLD body, the nonces no longer match, and the script is blocked — which
      // looks exactly like a preview that has quietly stopped remembering.
      const nonce = newPreviewNonce();
      res.setHeader("Content-Security-Policy", mdPreviewEmbedCsp(nonce));
      // The pane's theme, when it sent one (#2263). A value that is not a hex colour drops the
      // whole theme, so the document falls back to the reader's system colours.
      res.send(await embed(text, title, nonce, doc, previewThemeFromQuery(req.query)));
      return;
    }
    res.setHeader("Content-Security-Policy", "sandbox");
    res.send(await render(text, title, doc));
  });
}

/** The search a request asks for, or null when it asks for nothing searchable. `regex` and
 *  `case` are opt-in: absent means literal matching and smart case, which is what a query typed
 *  into an empty box should do. */
function searchRequestFrom(req: Request): SearchRequest | null {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (!isSearchable(query)) return null;
  // Only the exact string "1" turns a mode on. A checkbox sends a value we choose, and reading
  // anything truthy would make `?regex=false` enable regex.
  const flag = (name: string): boolean => req.query[name] === "1";
  return { query, regex: flag("regex"), ...(flag("case") ? { caseSensitive: true } : {}) };
}

/** Why a search did not happen. Two different things can refuse now, and the reader can only act on
 *  one of them, so they must not share a sentence.
 *
 *  `no-mode` is the probe failing — the machine was too busy to answer whether this is a repository.
 *  Nothing about the request is wrong and retrying is the whole remedy. Blaming the pattern here,
 *  which the previous single message did whenever regex mode was on, sends the reader to edit a
 *  regular expression that is perfectly good. */
type Refusal = "no-mode" | "search-refused";

const refusalMessage = (why: Refusal, request: SearchRequest): string => {
  if (why === "no-mode") return "the search could not be started here — try again";
  // The pattern is named only in regex mode, where it is the one part of the request git can
  // reject: a fixed string cannot be a bad pattern, so blaming it there would be equally wrong.
  return request.regex ? "that regular expression could not be used" : "the search could not be run in this directory";
};

/**
 * One search, in the mode this directory calls for.
 *
 * THE MODE IS ASKED, NOT INFERRED FROM A FAILURE — and that inversion is the whole of this
 * function. Inferring it drew three separate findings in one review: an invalid regex read as "not
 * a repository", a timed-out repository search answered as a successful `no-index` result, and a
 * plain directory refused because its first probe lost a race under load. Every patch was right
 * about the case it named and wrong about the shape, because `git grep` has ONE exit code (128) for
 * every refusal it makes and the stderr that separates them is discarded by design. No reading of
 * that code can carry the distinction, so the code is no longer asked to.
 *
 * What is PERMITTED is now the rule: a result comes back only when git ANSWERED — exit 0 or 1 — in
 * a mode chosen before the search ran. Everything else is a refusal, whatever caused it.
 *
 * TWO subprocesses either way, and that is a deliberate trade. Asking costs one more in a
 * repository than inferring did; it saves one in a plain directory, where the repository attempt
 * was always going to fail. Uniform beats cheaper-on-average here: the old shape's cost depended on
 * which answer came back, which is exactly what made its failures load-sensitive.
 */
async function runSearch(root: string, request: SearchRequest, signal: AbortSignal): Promise<SearchResult | Refusal> {
  const mode = modeFromProbe(await git(["rev-parse", "--is-inside-work-tree"], root, SEARCH_TIMEOUT_MS, signal));
  // A probe that did not ANSWER is not a mode. Defaulting here — which the first version of this
  // inversion did — sends a repository whose probe merely timed out into plain-directory mode, and
  // the search comes back with `.gitignore` unapplied.
  if (!mode) return "no-mode";
  const result = await git(searchArgv(request, mode), root, SEARCH_TIMEOUT_MS, signal);
  // A refusal is a refusal. There is no second mode to fall back to, because the first one was not
  // a guess — so whatever went wrong belongs to the search, and saying "nothing matched" about it
  // would be the misleading answer this shape exists to stop telling.
  return answered(result.code) ? { ...parseSearchOutput(result.stdout, result.code === null), source: mode } : "search-refused";
}

/** A refusal is one of two strings; a result is an object. */
const isRefusal = (outcome: SearchResult | Refusal): outcome is Refusal => typeof outcome === "string";

/** The content-search route. Its own mount for the reason `mountWriteRoute` is: the browse routes
 *  are already at the line budget, and a route that shells out deserves to be read on its own. */
function mountSearchRoute(app: Express, defaultCwd: string): void {
  // Search the CONTENTS of every file under the project base (#2140) — the companion to
  // /browse/index, which searches their names. Rooted at the base and not at `?path=` for the same
  // reason the index is: a result is handed to the tree and the editor, both of which resolve
  // relative to the root.
  //
  // Server-side per query, where the name finder ships its whole list once: the browser can hold
  // every path and cannot hold every file's text. So this is one subprocess per keystroke-after-
  // debounce, and the client aborts the previous one.
  app.get("/api/files/browse/search", async (req, res) => {
    const root = browseBase(req, defaultCwd);
    const request = searchRequestFrom(req);
    if (!request) return res.status(400).json({ error: "a search needs a query" });
    // A search the browser has walked away from is a subprocess nobody is waiting for. The panel
    // aborts its fetch on every keystroke-after-debounce, so without this each abandoned query
    // still costs a full `git grep` on a large repository — the client's cancellation would be a
    // claim about itself rather than about the work.
    //
    // Guarded on `writableEnded` because `close` also fires after a NORMAL response, where aborting
    // would kill nothing and mislead the next reader. Measured: a completed GET emits close with
    // `writableEnded === true`; a client abort before the response emits it with `false`.
    const hungUp = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) hungUp.abort();
    });
    try {
      const outcome = await runSearch(root, request, hungUp.signal);
      if (isRefusal(outcome)) return res.status(422).json({ error: refusalMessage(outcome, request) });
      res.json(outcome);
    } catch (err) {
      console.error("[api] /api/files/browse/search failed:", err);
      res.status(500).json({ error: "search failed" });
    }
  });
}

/** A 1-based line number off the query string, or null for anything that is not one.
 *
 *  Digits only, so `"1e3"`, `"1.5"` and a leading `+` are all refused rather than coerced into a
 *  line that was never asked for — and `Number.isSafeInteger` catches the run of digits too long to
 *  survive being a number at all. */
const lineParam = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const line = Number(value);
  return Number.isSafeInteger(line) && line > 0 ? line : null;
};

/** The lines around one line of a file, for the search panel's peek at a result (#2159).
 *
 *  Its OWN route rather than `/text`, which looks like it would do: `/text` calls `storeBackup`,
 *  because opening a file for editing is the last moment its content is certainly intact. Merely
 *  looking at five lines of a result is not that moment, and reusing it would rotate a backup every
 *  time the reader pressed an arrow key.
 *
 *  It does share `/text`'s guards through `readTextOr4xx`, so "directory / too large / not text /
 *  missing" is refused here exactly as it is everywhere else in this file. */
function mountLinesRoute(app: Express, defaultCwd: string): void {
  app.get("/api/files/browse/lines", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const around = lineParam(req.query.line);
    if (around === null) return res.status(400).json({ error: "line must be a positive integer" });
    const text = readTextOr4xx(res, abs);
    if (text === null) return;
    res.json(lineWindow(text, around, CONTEXT_RADIUS_LINES));
  });
}

// marked's union carries a generic token whose fields are `any`, so `type === "image"` alone
// does not narrow it.
const isImageToken = (token: Token): token is Tokens.Image => token.type === "image";

/** Markdown to HTML with each relative image pointed at the raw route, beside the document
 *  rather than under `/api/files/browse/` (#2261). A fresh instance per document, because the
 *  rewrite depends on where THIS document sits. Front matter is metadata, not body (#2264): only a
 *  block that parses as YAML counts, as on the Canvas and in MulmoClaude — a document may open
 *  with a `---` rule, and that is body. */
const mdBody = async (text: string, doc: ServedDoc): Promise<string> =>
  new Marked({
    walkTokens(token) {
      if (!isImageToken(token)) return;
      token.href = servedImageSrc(token.href, doc) ?? token.href;
    },
  }).parse(splitFrontmatter(text).body);

/** The Markdown document every caller has always had. */
const renderMd = async (text: string, title: string, doc: ServedDoc): Promise<string> => htmlDoc(await mdBody(text, doc), title);

/** The same document with the scroll reporter as its last body element (#2157). Composed here
 *  rather than inside `htmlDoc` so the shared document shell stays a shell that never runs
 *  anything, whoever calls it. */
const embedMd = async (text: string, title: string, nonce: string, doc: ServedDoc, theme: PreviewTheme | null): Promise<string> =>
  htmlDoc((await mdBody(text, doc)) + mdPreviewReporterTag(nonce), title, theme ? themeStyle(theme) : "");

export function mountFilesBrowseRoutes(app: Express, deps: BrowseDeps): void {
  const { defaultCwd, backupRoot } = deps;

  mountSearchRoute(app, defaultCwd);
  mountLinesRoute(app, defaultCwd);

  app.get("/api/files/browse/list", (req, res) => {
    const root = browseBase(req, defaultCwd);
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    try {
      if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "not a directory" });
      res.json({ cwd: path.resolve(root), path: browseRel(req), entries: listEntries(abs) });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  // Every file in the project as one flat list, for the pane's "open by name" finder (#2099).
  // Rooted at the project base and NOT at `?path=`: the finder hands what it picks straight to
  // the tree and the editor, both of which resolve relative to the root, so a list relative to
  // some subdirectory would open the wrong file at every depth.
  app.get("/api/files/browse/index", async (req, res) => {
    const root = browseBase(req, defaultCwd);
    try {
      res.json(await listProjectFiles(root));
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/files/browse/text", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return res.status(400).json({ error: "not a file" });
      if (stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large to edit" });
      // One read for both, so the version can't describe a different revision than the text.
      const bytes = fs.readFileSync(abs);
      // Refused rather than streamed into a textarea, which is what MAX_EDIT_BYTES' own comment
      // always claimed and only the size half of ever did. `toString("utf8")` replaces every byte
      // it cannot represent, so the file is already destroyed by the time it reaches the editor —
      // typing one character then commits the whole replacement (#2038: a 324-byte xlsx came back
      // 336 bytes and no longer opened as a zip). The BACKUP is taken from this same string, so
      // the safety net was storing the damaged version too; both are skipped by returning here.
      const text = losslessText(bytes);
      if (text === null) return res.status(415).json({ error: "this file cannot be edited as text", kind: "binary" });
      // Opening is the last moment this content is certainly intact — the editor may save over
      // it, and the agent in this directory may too. Same-content re-opens don't rotate.
      storeBackup(abs, text, backupRoot);
      res.json({ text, version: versionOfBytes(bytes) });
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  // Just the version, for the editor's periodic "did this move under me?" check. The full
  // /text response would ship the whole file every poll to answer a 16-character question.
  app.get("/api/files/browse/version", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    try {
      // The same cap as /text and /write. Without it, a file replaced on disk by a huge one
      // would be read and hashed in full on every poll — for a file the editor could no longer
      // open or save anyway.
      const stat = fs.statSync(abs, { throwIfNoEntry: false });
      if (stat && stat.size > MAX_EDIT_BYTES) return res.status(413).json({ error: "file too large" });
      res.json({ version: currentVersion(abs) });
    } catch {
      res.status(500).json({ error: "failed to read file" });
    }
  });

  const serveRendered = (routePath: string, render: RenderDoc, embed?: EmbedDoc) => mountRenderedRoute(app, routePath, defaultCwd, render, embed);

  serveRendered("/api/files/browse/md", renderMd, embedMd);
  serveRendered("/api/files/browse/json", (text, title) => jsonHtmlDoc(text, title));
  // The delimiter comes from the file's own extension, so one route serves .csv and .tsv.
  serveRendered("/api/files/browse/table", (text, title) => tableHtmlDoc(text, title, delimiterForExtension(path.extname(title))));

  mountWriteRoute(app, deps);
  mountBackupRoute(app, deps);
}

type BrowseDeps = { defaultCwd: string; backupRoot: string };

function mountWriteRoute(app: Express, { defaultCwd, backupRoot }: BrowseDeps): void {
  // Conditional write. `baseVersion` is the version the editor loaded (null = "I expect no
  // file here"); it is REQUIRED, because an optional one is a blind-write escape hatch and
  // blind writes are what this endpoint stopped doing. A mismatch answers 409 with the
  // version now on disk, which the caller can re-send to overwrite deliberately.
  app.put("/api/files/browse/write", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const body = requestBody(req.body);
    const text = body.text;
    const baseVersion = body.baseVersion;
    if (typeof text !== "string") return res.status(400).json({ error: "body.text (string) required" });
    if (baseVersion !== null && typeof baseVersion !== "string") return res.status(400).json({ error: "body.baseVersion (string|null) required" });
    if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) return res.status(413).json({ error: "content too large" });
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return res.status(400).json({ error: "path is a directory" });
      // Never write TEXT over content that is not text. This route only ever receives a string, so
      // overwriting a spreadsheet with one is always a loss — and the editor cannot be the only
      // thing stopping it: it reached here with an EMPTY buffer through Ctrl+S and "Overwrite
      // anyway", and truncated a 324-byte xlsx to 0 (CodeRabbit on #2038). Refused BEFORE
      // `backupCurrentFile`, which reads with "utf8" and would bank a damaged copy of the very
      // file it is meant to protect.
      if (fs.existsSync(abs) && losslessText(fs.readFileSync(abs)) === null) {
        return res.status(415).json({ error: "this file cannot be edited as text", kind: "binary" });
      }
      const onDisk = currentVersion(abs);
      if (onDisk !== baseVersion) return res.status(409).json({ error: "file changed on disk", version: onDisk });
      // What is about to be replaced, banked before it is. Best-effort: a backup that can't be
      // written must not turn into a refusal to save.
      backupCurrentFile(abs, backupRoot);
      const bytes = Buffer.from(text, "utf8");
      fs.writeFileSync(abs, bytes);
      res.json({ ok: true, version: versionOfBytes(bytes) });
    } catch {
      res.status(500).json({ error: "failed to write file" });
    }
  });
}

function mountBackupRoute(app: Express, { defaultCwd, backupRoot }: BrowseDeps): void {
  // Bank a buffer the CLIENT is about to discard — the conflict banner's "Reload", where the
  // content being dropped only ever existed in the editor. Nothing else can save it.
  app.put("/api/files/browse/backup", (req, res) => {
    const abs = containedFor(req, res, defaultCwd);
    if (!abs) return;
    const { text } = requestBody(req.body);
    if (typeof text !== "string") return res.status(400).json({ error: "body.text (string) required" });
    if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) return res.status(413).json({ error: "content too large" });
    res.json({ stored: storeBackup(abs, text, backupRoot) !== null });
  });
}
