import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import { readFirstJsonlRecord } from "../../infra/fs/jsonl-file.js";
import { canonicalPath } from "../../infra/fs/canonical-path.js";
import { agentHome } from "../agent-homes.js";
import { rolloutDayDirs } from "./codex-rollout-days.js";

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCH_POLL_MS = 1000;

export interface CodexSessionMeta {
  id: string;
  cwd: string | null;
}

// codex writes rollout transcripts under $CODEX_HOME/sessions/YYYY/MM/DD/. CODEX_HOME mirrors
// codex's own env, so a container/config relocation is honored (see the Docker plan).
export function codexSessionsRoot(): string {
  return path.join(agentHome("codex"), "sessions");
}

// The first line of every rollout is a `session_meta` record carrying the id codex minted for
// itself (mulmoterminal can't force one) and the cwd it resolved.
// The meta a parsed record carries, or null when it is not one. Split from the line parser below
// so the streaming reader — which hands back records, never lines — asks the same question.
function sessionMetaOf(doc: Record<string, unknown>): CodexSessionMeta | null {
  if (doc.type !== "session_meta" || !isRecord(doc.payload)) return null;
  const { id, cwd } = doc.payload;
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  return { id, cwd: typeof cwd === "string" ? cwd : null };
}

export function parseSessionMetaLine(line: string): CodexSessionMeta | null {
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return null;
  }
  return isRecord(doc) ? sessionMetaOf(doc) : null;
}

// The meta is codex's FIRST line, so only that line is read. It used to take the whole rollout to
// reach it, which the spawn watcher then repeated once a second for up to thirty minutes across
// every recent rollout — ~37 MB per pass on this machine to look at a few hundred bytes (#1553).
export async function readSessionMeta(rolloutFile: string): Promise<CodexSessionMeta | null> {
  try {
    const first = await readFirstJsonlRecord(rolloutFile);
    return first === null ? null : sessionMetaOf(first);
  } catch {
    return null;
  }
}

function listRolloutsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => ROLLOUT_RE.test(name))
    .map((name) => path.join(dir, name));
}

export function listRecentRollouts(root: string, now: Date = new Date(), startedAt: Date = now): string[] {
  return rolloutDayDirs(root, now, startedAt).flatMap(listRolloutsIn);
}

// The rollout files that exist BEFORE spawning codex; a file that appears after is this
// session's (codex only persists its rollout after the first user turn, so this can be minutes).
export function snapshotSessions(root: string, now: Date = new Date()): Set<string> {
  return new Set(listRecentRollouts(root, now));
}

interface RolloutMeta extends CodexSessionMeta {
  file: string;
}

// A rollout that appeared since the snapshot, attributed to this session ONLY when unambiguous:
// exactly one appeared, or exactly one of several matches this session's cwd. Otherwise refuse to
// guess (return null) — a wrong guess would let a cold resume reopen a *different* concurrent
// codex conversation. A "newest wins" tiebreak would be exactly that wrong guess, so there isn't
// one; a session that can't be attributed just stays unresumable-by-id (cold reconnect starts fresh).
// `claimed` holds rollouts already mapped to another session, so a single rollout is never
// attributed to two keys (which would resume one conversation from both).
//
// The sole-rollout branch checks the cwd too, when there is one to check: two spawns in DIFFERENT
// directories share the snapshot-diff window (~/.codex is one tree), and "exactly one new file"
// used to fire before the cwd was consulted — so the slower spawn claimed the faster spawn's
// rollout across directories (#1533). Compared canonically: codex records its own spelling of the
// path, and a worktree reached through a symlink must not read as a different directory (#1208).
const sameDir = (recorded: string | null | undefined, cwd: string | null): boolean =>
  cwd === null || (!!recorded && canonicalPath(recorded) === canonicalPath(cwd));

/** What one watcher carries between polls: the day it started, and every meta it has already read. */
export interface FreshScan {
  startedAt: Date;
  metaCache: Map<string, CodexSessionMeta>;
}

// A rollout's first line never changes once written, so a watcher that runs for the cell's whole
// life reads each foreign file once instead of once a poll. A file not carrying its meta yet is not
// kept: its first line may still be on its way.
async function cachedMeta(file: string, scan: FreshScan | undefined): Promise<CodexSessionMeta | null> {
  const known = scan?.metaCache.get(file);
  if (known) return known;
  const meta = await readSessionMeta(file);
  if (meta) scan?.metaCache.set(file, meta);
  return meta;
}

export async function pickFreshSession(
  root: string,
  before: Set<string>,
  cwd: string | null,
  claimed?: Set<string>,
  scan?: FreshScan,
): Promise<RolloutMeta | null> {
  const candidates = listRecentRollouts(root, new Date(), scan?.startedAt).filter((file) => !before.has(file) && !claimed?.has(file));
  const read = await Promise.all(candidates.map(async (file) => ({ file, meta: await cachedMeta(file, scan) })));
  // Everything from here to the claim runs in ONE synchronous block, and the `claimed` filter is
  // re-applied rather than trusted from before the await. Reading the meta used to be synchronous,
  // so selecting and claiming could not be interleaved; with the read awaited, two watchers polling
  // the same tick would otherwise both pass the filter above, both pick the same rollout, and both
  // map it to a different session — the duplicate attribution #1533 exists to prevent (Codex on
  // #1555).
  const found = read.filter((x): x is { file: string; meta: CodexSessionMeta } => x.meta !== null && !claimed?.has(x.file));
  const picked = soleFresh(found, cwd);
  if (!picked) return null;
  claimed?.add(picked.file);
  return { ...picked.meta, file: picked.file };
}

// Exactly one new rollout, or exactly one whose cwd agrees — the refusal to guess, kept apart from
// the claiming above so the rule stays readable.
function soleFresh(found: readonly { file: string; meta: CodexSessionMeta }[], cwd: string | null) {
  const sole = found.length === 1 ? found[0] : undefined;
  if (sole && sameDir(sole.meta.cwd, cwd)) return sole;
  const matches = cwd ? found.filter((x) => sameDir(x.meta.cwd, cwd)) : [];
  return matches.length === 1 ? matches[0] : undefined;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// codex persists a session's rollout only AFTER its first user turn (like claude's transcript),
// so we watch for the whole session — not just at spawn — until the rollout appears, then read
// its minted id. Stops when the session is gone (isCancelled) so it can't outlive the pty. No
// deadline unless one is asked for: a first prompt can come hours after the cell opened.
export async function watchForCodexSession(
  root: string,
  before: Set<string>,
  opts: { cwd?: string | null; pollMs?: number; maxWaitMs?: number; isCancelled?: () => boolean; claimed?: Set<string> } = {},
): Promise<RolloutMeta | null> {
  const pollMs = opts.pollMs ?? WATCH_POLL_MS;
  const deadline = opts.maxWaitMs === undefined ? Infinity : Date.now() + opts.maxWaitMs;
  const isCancelled = opts.isCancelled ?? (() => false);
  const cwd = opts.cwd ?? null;
  const scan: FreshScan = { startedAt: new Date(), metaCache: new Map() };
  let result = await pickFreshSession(root, before, cwd, opts.claimed, scan);
  while (!result && Date.now() < deadline && !isCancelled()) {
    await delay(pollMs);
    result = await pickFreshSession(root, before, cwd, opts.claimed, scan);
  }
  // The claim is made by `pickFreshSession`, synchronously with the selection (#1533, and see the
  // note there on why the await made that necessary). What is left here is releasing it: the read
  // is asynchronous now, so the session this watcher speaks for can die DURING it — and a claim
  // that outlives its session is either an attribution to a dead pty or a rollout no other session
  // can ever take (Codex on #1555). Released rather than kept, because nothing else will.
  if (result && isCancelled()) {
    opts.claimed?.delete(result.file);
    return null;
  }
  return result;
}
