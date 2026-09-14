// A cursor session's own record of itself: the per-directory chat list the launcher's "or resume
// here" offers, and the existence probe the survivor guard asks.
//
// Cursor keeps chats under `~/.cursor/projects/<slug>/agent-transcripts/<chatId>/<chatId>.jsonl`,
// where `<slug>` is derived from the working directory — and NOT derivably: long paths are
// truncated and suffixed with a hash (`…-mulmotermina-e83f160`), so reconstructing one from a cwd
// means reimplementing an undocumented rule that will rot. The directory records its own path
// instead, in `.workspace-trusted`, and that file is what this module reads.
//
// It is not written for every project directory — measured, the three directories with no chats had
// none — but every directory that HAD chats had one. That correlation is what makes this safe
// rather than merely convenient: a project directory we cannot attribute is OMITTED, so the failure
// mode is "nothing to resume here", never another directory's conversations.
//
// CURSOR ITSELF SCOPES CHATS BY DIRECTORY. Measured: resuming a chat id belonging to another
// directory starts an EMPTY conversation rather than that directory's — asked what shell command it
// had been given earlier, it answered that this was the first message. So the cwd-bound probe below
// is defence in depth rather than the only thing standing between a hand-edited `?session=` and
// another project's history, which is what it is for copilot.
import { existsSync, readdirSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { cursorUserText } from "./cursor-last-turn.js";
import { readString } from "../../common/readString.js";
import { cursorHome } from "./cursor-hooks-file.js";

const projectsRoot = (home: string): string => path.join(home, "projects");
const transcriptsDir = (project: string): string => path.join(project, "agent-transcripts");

/** Directory names under `projects/`, or [] when cursor has never run here.
 *
 *  Two versions, and the split is the survivor guard's: `SurvivorEvidence` is a table of
 *  SYNCHRONOUS predicates, so the "does this id exist anywhere" probe cannot await. Everything on
 *  a request path uses the async one — a listing that stats every chat on the event loop delays
 *  every WebSocket and HTTP client sharing it (CodeRabbit on #2065). */
function projectDirsSync(home: string): string[] {
  try {
    return readdirSync(projectsRoot(home), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsRoot(home), entry.name));
  } catch {
    return [];
  }
}

async function projectDirs(home: string): Promise<string[]> {
  try {
    const entries = await readdir(projectsRoot(home), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(projectsRoot(home), entry.name));
  } catch {
    return [];
  }
}

const workspacePathOf = (raw: unknown): string | null => (isRecord(raw) ? readString(raw.workspacePath) || null : null);

/** The real working directory a project directory stands for, or null when it does not say. */
async function workspaceOf(project: string): Promise<string | null> {
  try {
    return workspacePathOf(JSON.parse(await readFile(path.join(project, ".workspace-trusted"), "utf8")));
  } catch {
    return null;
  }
}

/** EVERY project directory that records this cwd, not the first.
 *
 *  `.find()` was wrong for a reason that is invisible when it happens: cursor's directory name is a
 *  truncated-and-hashed slug, so more than one can name the same workspace — and the first one
 *  found is not necessarily the one holding the chats. An empty duplicate would then hide a real
 *  conversation from BOTH the listing and the resume probe, and the symptom is a cell that quietly
 *  starts a new chat instead of resuming (Codex round 2 of #2065, P2). */
async function projectsForCwd(cwd: string, home: string): Promise<string[]> {
  const dirs = await projectDirs(home);
  const owners = await Promise.all(dirs.map((project) => workspaceOf(project)));
  return dirs.filter((_, i) => owners[i] === cwd);
}

/** Where this session's transcript is, or null when no project directory in `cwd` holds it.
 *
 *  The slug a project directory is named by is a truncated-and-hashed form of the path and cannot
 *  be reconstructed, which is why this asks each directory what it stands for rather than computing
 *  one (the same walk the resume probe and the listing make). `stop` also hands the path over
 *  outright — but only on a turn boundary, and a reader that needs it between turns cannot wait for
 *  one. */
export async function cursorTranscriptPath(cwd: string, id: string, home: string = cursorHome()): Promise<string | null> {
  const projects = await projectsForCwd(cwd, home);
  const found = await Promise.all(
    projects.map((project) => {
      const file = path.join(transcriptsDir(project), id, `${id}.jsonl`);
      return stat(file).then(
        () => file,
        () => null,
      );
    }),
  );
  return found.find((file): file is string => file !== null) ?? null;
}

/** Is there a cursor chat by this id ANYWHERE on this machine? The survivor guard's question, and
 *  deliberately a different one from the resume probe below: the guard asks "what wrote this key"
 *  about a session that outlived a server restart, and the request that reattaches one often
 *  carries no cwd to check against. */
export function cursorSessionExists(id: string, home: string = cursorHome()): boolean {
  return projectDirsSync(home).some((project) => existsSync(path.join(transcriptsDir(project), id)));
}

/** May a connection in `cwd` RESUME this id? Bound to the directory, as grok's and copilot's probes
 *  are. */
export async function cursorSessionExistsForCwd(id: string, cwd: string, home: string = cursorHome()): Promise<boolean> {
  const projects = await projectsForCwd(cwd, home);
  const found = await Promise.all(
    projects.map((project) =>
      stat(path.join(transcriptsDir(project), id)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.some(Boolean);
}

export interface CursorSessionMeta {
  id: string;
  /** The first thing the user said, which is the only summary cursor keeps on disk. */
  title: string;
  mtimeMs: number;
}

// The transcript is a conversation and has no bound, so only its head is read — enough for the
// first record, never the whole file (docs/large-file-reading.md).
const TITLE_SCAN_BYTES = 4096;

/** The first user message in a transcript, or "". Its shape, measured: one JSON object per line,
 *  `{"role":"user","message":{"content":[{"type":"text","text":"…"}]}}`, and the text is wrapped in
 *  `<user_query>` tags after a `<timestamp>` block that cursor prepends. */
export function cursorTranscriptTitle(head: string): string {
  const line = head.split("\n").find((candidate) => candidate.trim().length > 0);
  if (!line) return "";
  try {
    const raw: unknown = JSON.parse(line);
    if (!isRecord(raw) || raw.role !== "user" || !isRecord(raw.message)) return "";
    const content: unknown = raw.message.content;
    if (!Array.isArray(content)) return "";
    const parts: unknown[] = content;
    const first = parts.find((part) => isRecord(part) && readString(part.text) !== "");
    const text = isRecord(first) ? readString(first.text) : "";
    // Shared with the last-turn reader, which is where the rule is written down: cursor does not
    // escape the marker, so a prompt containing the literal `</user_query>` truncates under the
    // non-greedy regex this used to hold.
    return cursorUserText(text);
  } catch {
    return "";
  }
}

async function readTitle(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(TITLE_SCAN_BYTES);
    // A bounded read, not readFile: a transcript is a whole conversation and grows without limit,
    // and only its first line is wanted. The last line in the window is very likely truncated,
    // which is why cursorTranscriptTitle only ever looks at the first.
    const { bytesRead } = await handle.read(buffer, 0, TITLE_SCAN_BYTES, 0);
    return cursorTranscriptTitle(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {
      // Nothing the caller can do; the title is already decided.
    });
  }
}

/** The chat ids recorded under a project directory. */
async function chatIds(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * This directory's chats, newest first, at most `limit` of them.
 *
 * The limit is the helper's business and not the route's, because it decides how much I/O happens:
 * a `mtimeMs` is one stat and every chat needs one to be sorted, but a TITLE is a file open and a
 * read, and only the rows that will be SHOWN need one. Reading all of them and slicing afterwards
 * is the shape this had first, and on a directory with a few hundred chats it was hundreds of
 * opens nobody would see the result of.
 */
export async function listCursorSessionsForCwd(cwd: string, home: string = cursorHome(), limit = Infinity): Promise<CursorSessionMeta[]> {
  const projects = await projectsForCwd(cwd, home);
  const seen = new Set<string>();
  const dated: { id: string; file: string; mtimeMs: number }[] = [];
  for (const project of projects) {
    const root = transcriptsDir(project);
    const ids = await chatIds(root);
    const stats = await Promise.all(
      ids.map(async (id) => {
        // A chat id is cursor's own uuid, so the same one under two project directories for this
        // cwd is one conversation, not two rows.
        if (seen.has(id)) return null;
        const file = path.join(root, id, `${id}.jsonl`);
        try {
          return { id, file, mtimeMs: (await stat(file)).mtimeMs };
        } catch {
          return null; // a chat directory with no transcript yet
        }
      }),
    );
    for (const row of stats) {
      if (!row) continue;
      seen.add(row.id);
      dated.push(row);
    }
  }
  const newestFirst = dated.toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  const shown = newestFirst.slice(0, limit === Infinity ? newestFirst.length : limit);
  const titles = await Promise.all(shown.map((row) => readTitle(row.file)));
  return shown.map((row, i) => ({ id: row.id, title: titles[i] ?? "", mtimeMs: row.mtimeMs }));
}
