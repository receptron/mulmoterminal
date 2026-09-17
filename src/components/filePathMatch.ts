// Which project files a typed fragment means, and how well — the whole of what the Files pane's
// finder does with a keystroke (#2099). Pure, and in its own file, because the value of the
// feature IS the ranking: "多少あいまいな入力でも一致してほしい" is a claim that can only be
// checked by running the ranking over inputs, never by looking at a rendered list.
//
// The match is a SUBSEQUENCE, not a substring: every query character in order, anywhere.
// "fpane" finds `src/components/FilesPane.vue`, and so does "srccompfp".
//
// Scored by dynamic programming rather than by a left-to-right greedy scan, because greedy takes
// the first occurrence of each character and that is routinely the wrong one — "test" against
// `src/components/testLatest.ts` greedily spends its `t` inside "componenTs" and then reads as a
// scattered match, where the alignment a reader sees is the exact run at the start of the name.
import { byCodeUnit } from "../../common/byCodeUnit";

export interface PathMatch {
  /** The candidate, exactly as it was given — relative to the tree's root. */
  path: string;
  /** Higher is a better match. Comparable only between matches of the SAME query. */
  score: number;
  /** Ascending indexes into `path` that the query landed on, for highlighting. */
  indexes: number[];
}

const SCORE_MATCH = 16;
/** First character, or one just after a separator — where a human would start reading a word. */
const BONUS_BOUNDARY = 8;
/** The `P` of `FilesPane`: a capital after a lower-case letter starts a word with no separator. */
const BONUS_CAMEL = 6;
/** Anywhere in the last segment. What makes a hit on the file's NAME beat one strewn through the
 *  directories above it, which is the whole reason someone types a name rather than a path. */
const BONUS_BASENAME = 4;
/** Awarded instead of the position bonus when this character continues an unbroken run. Larger
 *  than BONUS_BOUNDARY on purpose: with the two equal, `s-e-t-t-i-n-g-s.ts` outranks
 *  `settings.ts` for "settings", because every separator hands the character after it a boundary
 *  bonus worth more than the gap it costs. An unbroken run has to be the better answer. */
const BONUS_CONSECUTIVE = 12;
/** Per character skipped between two matched ones.
 *
 *  Characters before the FIRST match are free, and that falls out rather than being special-cased:
 *  the first query character's score does not depend on where it lands. Exempting row 0 from this
 *  penalty instead is what let a separator-riddled name win — the skip AFTER row 0's match is an
 *  internal gap, and exempting the row made it free. */
const PENALTY_GAP = -3;

/** Lower than any reachable score, and far enough from it that adding a bonus stays unreachable. */
const UNREACHABLE = -1_000_000;

/** Past this the query is not a search any more, and the matrix below is sized by it. */
const MAX_QUERY_CHARS = 64;

const BOUNDARY_CHARS = new Set(["/", "\\", "-", "_", ".", " ", "@"]);

/** Whitespace is dropped rather than matched: nothing in a path is a space often enough to be
 *  worth typing, and a trailing one from a paste would otherwise make every candidate vanish. */
export const normalizeQuery = (query: string): string => query.replace(/\s+/gu, "").slice(0, MAX_QUERY_CHARS).toLowerCase();

/** Cheap rejection: is `query` a subsequence of `lower` at all? Runs once per candidate and
 *  removes nearly all of them, so the matrix is only ever built for something that can match. */
function isSubsequence(lower: string, query: string): boolean {
  let at = 0;
  for (const char of query) {
    at = lower.indexOf(char, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

/** What each position in `path` is worth before any run bonus. Computed from the ORIGINAL casing,
 *  which is where the camel-case boundary lives — the lower-cased copy the matching runs on has
 *  already thrown it away. */
function bonusTable(path: string): Int32Array {
  const bonuses = new Int32Array(path.length);
  const basenameAt = path.lastIndexOf("/") + 1;
  for (let i = 0; i < path.length; i += 1) {
    bonuses[i] = positionBonus(i === 0 ? "" : (path[i - 1] ?? ""), path[i] ?? "") + (i >= basenameAt ? BONUS_BASENAME : 0);
  }
  return bonuses;
}

/** What starting a word here is worth, from the character before it and the character itself.
 *  An empty `prev` means the start of the path. */
function positionBonus(prev: string, here: string): number {
  if (prev === "" || BOUNDARY_CHARS.has(prev)) return BONUS_BOUNDARY;
  // A lower-case letter followed by a non-lower-case one: `FilesPane`'s `P`, but not `HTTPServer`'s
  // inner capitals, which start no word a reader would type from.
  const isCamel = prev === prev.toLowerCase() && prev !== prev.toUpperCase() && here !== here.toLowerCase();
  return isCamel ? BONUS_CAMEL : 0;
}

/** The four matrices one match needs, reused between calls.
 *
 *  Module-scoped scratch, grown on demand, because the finder scores thousands of candidates per
 *  keystroke and a fresh allocation per candidate is the only part of this that would be slow.
 *  Safe because JavaScript is single-threaded and nothing here awaits: each `matchPath` fills the
 *  buffers and reads them back before returning. */
interface Scratch {
  /** Best score whose last matched character is exactly here. */
  ending: Int32Array;
  /** Best score for this query prefix using this path prefix, matched here or earlier. */
  best: Int32Array;
  /** `best` took `ending` here — i.e. this position IS the match. */
  tookMatch: Uint8Array;
  /** `ending` here continues the previous match at the position before it. */
  tookRun: Uint8Array;
}
let scratch: Scratch = { ending: new Int32Array(0), best: new Int32Array(0), tookMatch: new Uint8Array(0), tookRun: new Uint8Array(0) };

function scratchFor(cells: number): Scratch {
  if (scratch.ending.length >= cells) return scratch;
  scratch = { ending: new Int32Array(cells), best: new Int32Array(cells), tookMatch: new Uint8Array(cells), tookRun: new Uint8Array(cells) };
  return scratch;
}

/** Everything one row of the recurrence reads. An object rather than six arguments, and so that
 *  the three functions below share exactly the same view of it. */
interface RowContext {
  lower: string;
  query: string;
  bonuses: Int32Array;
  cells: Scratch;
  width: number;
  qi: number;
}

/** Starting a fresh run here: the best alignment of the earlier query characters that finished
 *  anywhere to the left, plus this position's own bonus. The FIRST query character has no such
 *  history and starts from zero wherever it lands — which is what makes the characters before the
 *  first match free. */
function openedAt(ctx: RowContext, j: number): number {
  if (ctx.qi === 0) return SCORE_MATCH + (ctx.bonuses[j] ?? 0);
  if (j === 0) return UNREACHABLE;
  const base = ctx.cells.best[(ctx.qi - 1) * ctx.width + j - 1] ?? UNREACHABLE;
  return base <= UNREACHABLE ? UNREACHABLE : base + SCORE_MATCH + (ctx.bonuses[j] ?? 0);
}

/** Continuing the run: the previous query character matched at the position immediately before. */
function continuedAt(ctx: RowContext, j: number): number {
  if (ctx.qi === 0 || j === 0) return UNREACHABLE;
  const base = ctx.cells.ending[(ctx.qi - 1) * ctx.width + j - 1] ?? UNREACHABLE;
  return base <= UNREACHABLE ? UNREACHABLE : base + SCORE_MATCH + Math.max(ctx.bonuses[j] ?? 0, BONUS_CONSECUTIVE);
}

/** One row of the recurrence: query character `qi` placed at every position of the path. */
function fillRow(ctx: RowContext): void {
  const row = ctx.qi * ctx.width;
  for (let j = 0; j < ctx.width; j += 1) {
    const continued = continuedAt(ctx, j);
    const ending = ctx.lower[j] === ctx.query[ctx.qi] ? Math.max(openedAt(ctx, j), continued) : UNREACHABLE;
    const skipped = j === 0 ? UNREACHABLE : (ctx.cells.best[row + j - 1] ?? UNREACHABLE) + PENALTY_GAP;
    ctx.cells.ending[row + j] = ending;
    ctx.cells.best[row + j] = Math.max(ending, skipped);
    ctx.cells.tookMatch[row + j] = ending >= skipped && ending > UNREACHABLE ? 1 : 0;
    ctx.cells.tookRun[row + j] = ending === continued && continued > UNREACHABLE ? 1 : 0;
  }
}

/** Where the last query character lands in the best alignment, and what that alignment scores.
 *  Read off `ending` rather than `best` so a long tail after the final match costs nothing — the
 *  gap penalty is about holes INSIDE the match, not about the rest of the file name. */
function bestEnd(cells: Scratch, width: number, lastRow: number): { at: number; score: number } {
  let at = -1;
  let score = UNREACHABLE;
  for (let j = 0; j < width; j += 1) {
    const here = cells.ending[lastRow + j] ?? UNREACHABLE;
    if (here > score) {
      score = here;
      at = j;
    }
  }
  return { at, score };
}

/** Walk the alignment back to the first query character, collecting the positions it used. */
function traceback(cells: Scratch, width: number, queryLength: number, endAt: number): number[] {
  const indexes: number[] = [];
  let qi = queryLength - 1;
  let j = endAt;
  while (qi >= 0 && j >= 0) {
    indexes.push(j);
    if (qi === 0) break;
    if (cells.tookRun[qi * width + j] === 1) {
      j -= 1;
    } else {
      // The previous character was matched somewhere left of here; the row's `tookMatch` flags
      // say where the best alignment for that prefix actually put it.
      j -= 1;
      while (j >= 0 && cells.tookMatch[(qi - 1) * width + j] !== 1) j -= 1;
    }
    qi -= 1;
  }
  return indexes.reverse();
}

/** How well `path` answers `query`, or null when it does not contain it as a subsequence at all.
 *  Case-insensitive: the query is lower-cased here as well as in `normalizeQuery`, so calling this
 *  on its own cannot silently match nothing because of a capital. */
export function matchPath(path: string, query: string): PathMatch | null {
  const wanted = query.toLowerCase();
  if (wanted === "") return { path, score: 0, indexes: [] };
  const lower = path.toLowerCase();
  if (!isSubsequence(lower, wanted)) return null;
  const width = lower.length;
  const cells = scratchFor(wanted.length * width);
  const ctx: RowContext = { lower, query: wanted, bonuses: bonusTable(path), cells, width, qi: 0 };
  for (ctx.qi = 0; ctx.qi < wanted.length; ctx.qi += 1) fillRow(ctx);
  const end = bestEnd(cells, width, (wanted.length - 1) * width);
  if (end.at < 0) return null; // unreachable: isSubsequence already said the alignment exists
  return { path, score: end.score, indexes: traceback(cells, width, wanted.length, end.at) };
}

/** Best first. Ties go to the shorter path — the one with less around the part that matched —
 *  and then to code-unit order, so the list a user sees never depends on input order. */
export function compareMatches(a: PathMatch, b: PathMatch): number {
  return b.score - a.score || a.path.length - b.path.length || byCodeUnit(a.path, b.path);
}

/** The finder's whole answer: at most `limit` candidates, best first. An empty query keeps the
 *  order it was given, which is the server's — the first page of the project rather than nothing,
 *  so the list is never blank before the first keystroke. */
export function rankPaths(paths: readonly string[], query: string, limit: number): PathMatch[] {
  const normalized = normalizeQuery(query);
  if (normalized === "") return paths.slice(0, limit).map((path) => ({ path, score: 0, indexes: [] }));
  return paths
    .map((path) => matchPath(path, normalized))
    .filter((match): match is PathMatch => match !== null)
    .sort(compareMatches)
    .slice(0, limit);
}

/** A run of characters that either did or did not take part in the match. */
export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** `text` cut into alternating matched / unmatched runs. Adjacent matched characters become ONE
 *  part, so a run of five renders as a single emphasised span rather than five.
 *
 *  `split("")` rather than `[...text]`, which is the same everywhere except where it matters:
 *  the spread iterates CODE POINTS, and `matchPath`'s indexes are CODE UNITS. One astral
 *  character earlier in the path shifts every index by one, and the wrong character is
 *  highlighted from there on — `😀a.ts` matched on "a" lights up the emoji's tail
 *  (CodeRabbit on #2102). */
export function highlightParts(text: string, indexes: readonly number[]): HighlightPart[] {
  const wanted = new Set(indexes);
  return text.split("").reduce<HighlightPart[]>((parts, char, index) => {
    const hit = wanted.has(index);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += char;
    else parts.push({ text: char, hit });
    return parts;
  }, []);
}

/** One row of the finder: the file's own name and the directories above it, each already cut into
 *  highlight runs. Split because the name is what the eye goes to — the directory is context, and
 *  is shown quieter and after it, the way an editor's "go to file" has always shown it.
 *
 *  The separator between them belongs to neither, so a match that landed on a `/` simply is not
 *  drawn. Nothing hangs on it: the query character is still in `indexes`. */
export function finderRow(path: string, indexes: readonly number[]): { name: HighlightPart[]; dir: HighlightPart[] } {
  const at = path.lastIndexOf("/") + 1;
  const dirText = at === 0 ? "" : path.slice(0, at - 1);
  return {
    name: highlightParts(
      path.slice(at),
      indexes.filter((i) => i >= at).map((i) => i - at),
    ),
    dir: highlightParts(
      dirText,
      indexes.filter((i) => i < dirText.length),
    ),
  };
}
