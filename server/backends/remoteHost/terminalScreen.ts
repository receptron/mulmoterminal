// The session picker + screen read behind the phone's remote terminal view (#435).
//
// Both entry points are dependency-injected and free of server/index.ts internals, so the
// join rules and the capture fallback are unit-testable without a live PTY or tmux.
import { parseStyledRows, rowsToScreen, suggestionFromRows, type ScreenRow } from "../../session/screen-rows.js";
import { TERMINAL_AGENTS, type SessionAgent } from "../../../common/sessionAgent.js";
import { workItemHeadline, type PrPhase, type WorkItem } from "../../../common/prPhase.js";
import type { QuickCommandChip } from "./quickCommands.js";
import { basename } from "node:path";
import { getAgentAdapter } from "../../agents/registry.js";
import type { AgentKind } from "../../agents/types.js";

// Map a tmux pane's current command onto the kinds the phone knows. Anything else is a
// shell or a one-off program the phone has no special input for — "shell" is the right
// answer for both, since that is where typed commands belong.
//
// Two spellings per agent: the DEFAULT binary name, and whatever `*_BIN` points at — a pane
// reports the running program's own name, so a user who set `ANTIGRAVITY_BIN=/opt/agy-next` has
// panes called `agy-next`, and matching only the default would report their agent as a shell.
// The basename, because that is what a pane command is; the default stays in the map either way,
// so overriding the variable never un-recognises sessions started before it was set.
const AGENT_DEFAULT_COMMAND: Record<AgentKind, string> = {
  claude: "claude",
  codex: "codex",
  antigravity: "agy",
  grok: "grok",
  muse: "muse",
  copilot: "copilot",
  cursor: "cursor-agent",
};

const agentCommands = (): Record<string, SessionAgent> => {
  const map: Record<string, SessionAgent> = {};
  // Over the KIND list rather than Object.entries, which widens the keys of a Record back to
  // `string` and cost three assertions to undo.
  for (const kind of TERMINAL_AGENTS) {
    map[AGENT_DEFAULT_COMMAND[kind]] = kind;
    map[basename(getAgentAdapter(kind).bin())] = kind;
  }
  return map;
};

export const agentFromPaneCommand = (command: string | null): SessionAgent | null => {
  if (!command) {
    return null;
  }
  // Rebuilt per call rather than cached: the env vars are read at call time everywhere else too
  // (adapter.bin()), and this runs once per session row, not per frame.
  return agentCommands()[command] ?? "shell";
};

// What a session is working on, as the phone needs it: numbers to identify it, a phase for the
// colour, and ONE line of words. The phone has no room for both titles, and what the work is FOR
// beats what was done about it — see workItemHeadline (#1014).
export interface SessionWorkSummary {
  pr: number | null;
  issue: number | null;
  phase: PrPhase;
  headline: string | null;
}

export interface TerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  // Absent when the directory is not a GitHub checkout, or has no PR and no issue to name.
  work?: SessionWorkSummary;
  // A PTY is attached in THIS server process. False means the session exists only in tmux
  // (it outlived a restart) — still viewable, since capture-pane doesn't need our process.
  live: boolean;
  // What is running in it, or null when unknown (see SessionAgent). A tmux-only
  // session is always null: the process that knew is gone.
  agent: SessionAgent | null;
  // Which entry of the reply's `icons` table draws this row's project image (#1556). Absent when
  // the directory configures none, when its file could not be read, and when the reply's icon
  // budget was already spent — all three of which the phone answers the same way, with the plain
  // terminal glyph it drew before.
  iconId?: string;
}

export interface SessionDetail {
  // Empty when the host has no name for this session — neither an AI-generated title
  // nor a recorded one. Such a session is dropped unless it is live (see below).
  title: string;
  cwd: string;
  agent: SessionAgent | null;
  work?: SessionWorkSummary;
}

// What a host's `detailOf` may hand over. Deliberately looser than SessionDetail: writing
// `work: map.get(cwd)` leaves the key behind holding `undefined`, and buildSessionList is
// what drops it. The wire shape must not carry such a key — see the note there (#1042).
export interface SessionDetailDraft extends Omit<SessionDetail, "work"> {
  work?: SessionWorkSummary | undefined;
}

// The work item as the phone should see it, or undefined when there is nothing to say. Kept here
// rather than at the call site so the "what counts as worth sending" rule has one home: a merged
// or closed PR is finished work, which is also why the header chip clears itself on merge.
export function sessionWorkSummary(item: WorkItem): SessionWorkSummary | undefined {
  if (item.phase === "merged" || item.phase === "closed") return undefined;
  if (item.pr === null && item.issue === null) return undefined;
  return { pr: item.pr, issue: item.issue, phase: item.phase, headline: workItemHeadline(item) };
}

export interface SessionListInput {
  liveIds: readonly string[];
  tmuxIds: readonly string[];
  // Excludes sessions an orphan cleanup would reap — without it the picker fills with
  // long-dead tmux shells (66 of them on the author's machine when this was written).
  isResumable: (id: string) => boolean;
  // Keeps only multi-terminal GRID sessions (the dev-terminal set). The phone drives the
  // grid's cells, so the single-view chat session and any tmux shell that was never a grid
  // cell are excluded — even while they are live and resumable.
  isGridSession: (id: string) => boolean;
  detailOf: (id: string) => SessionDetailDraft;
}

// Live sessions first, then by title, so the phone's list is stable across polls.
const byLiveThenTitle = (a: TerminalSessionSummary, b: TerminalSessionSummary): number =>
  a.live === b.live ? a.title.localeCompare(b.title) : Number(b.live) - Number(a.live);

// Resumable is the right rule for "don't reap this", but too weak for "offer this":
// it keeps every session with a transcript on disk, which on a working machine is
// dozens of long-finished ones the host can no longer name. A row showing nothing but
// a UUID is not a choice the user can make, so a nameless session earns its place only
// by being live — where the id at least identifies something currently running.
export function buildSessionList({ liveIds, tmuxIds, isResumable, isGridSession, detailOf }: SessionListInput): TerminalSessionSummary[] {
  const live = new Set(liveIds);
  const ids = [...new Set([...liveIds, ...tmuxIds])].filter(isResumable).filter(isGridSession);
  return (
    ids
      .map((id) => ({ id, ...detailOf(id), live: live.has(id) }))
      .filter((session) => session.title !== "" || session.live)
      .map((session) => ({ ...session, title: session.title || session.id }))
      // `work` is optional, and optional here has to mean the KEY IS ABSENT — not present holding
      // `undefined`. A caller writing `work: map.get(cwd)` leaves the key behind, the spreads above
      // carry it through, and Firestore then refuses the entire reply: every session vanishes from
      // the phone rather than one row losing its badge (#1042). Dropped here, at the type that
      // declares it optional, so a future `detailOf` cannot reintroduce it.
      .map(({ work, ...rest }) => (work ? { ...rest, work } : rest))
      .sort(byLiveThenTitle)
  );
}

// How much scrollback the phone is shown above the visible pane. One pane's worth is too
// little to read on a phone — the output that explains what just happened has already
// scrolled off (mulmoserver#139).
export const SCREEN_HISTORY_ROWS = 300;

// The second bound, and the reason it exists: the reply is written to a Firestore command
// doc, which rejects anything over 1 MiB. Before the history the row count alone kept the
// screen small (see the note at the top of handlers/terminalSession.ts); it no longer does.
// 300 rows of a 200-column pane in Japanese is ~180 KB, so this only bites on a pane far
// wider than any phone will ever read comfortably — it is a ceiling, not a budget.
const SCREEN_MAX_BYTES = 256 * 1024;

// Newline, counted alongside each row so the cap measures the string the phone receives.
const ROW_SEPARATOR_BYTES = 1;

export interface ScreenSource {
  buffer: string;
  cols: number;
  rows: number;
}

export interface CaptureScreenDeps {
  captureStyledPane: (id: string) => string | null;
  sourceOf: (id: string) => ScreenSource | undefined;
  render: (input: ScreenSource) => Promise<ScreenRow[]>;
  // What the grid cell's header shows for this session, for the phone to head the screen
  // with (#786). Optional: a host that can't answer any of it just sends the screen.
  metaOf?: (id: string) => Promise<SessionScreenMeta>;
  // The user's saved phrases that apply to THIS session, already scoped to its kind (#830).
  // Optional, and an unconfigured host simply offers none.
  quickCommandsOf?: (id: string) => QuickCommandChip[];
}

// The session's identity around the screen — the dir it runs in, that dir's git branch, the
// AI summary of the session, and the prompt that started the latest turn (mulmoserver#107).
// Every field is optional: a session that outlived a restart has no PTY left, so the host
// knows none of them.
export interface SessionScreenMeta {
  cwd?: string;
  branch?: string;
  // The user's own one-line note on the session (#1084), which the phone shows ABOVE the summary:
  // the line the user wrote outranks what the agent said (sessionDisplayName). Its own field
  // rather than riding in `summary` the way the picker's row rides in `title` — `summary` is drawn
  // as a row labelled as the AI's summary, so a handwritten note put there would be mislabelled.
  memo?: string;
  summary?: string;
  prompt?: string;
  // The dir's REPOSITORY ROOT on GitHub, so the phone can link out to it (#832). Absent for
  // every dir the host can't place there — not a repo, no origin, or an origin that isn't
  // github.com — which is why the phone only ever has to decide "link or no link".
  // Not a /tree/<branch>: see the note where this is filled in (server/index.ts).
  githubUrl?: string;
  // The directory's own image, ready for an `<img src>` (#1556). The src itself rather than an
  // id into a table: one screen carries one icon, so there is nothing to deduplicate against.
  icon?: string;
}

export interface SessionScreen extends SessionScreenMeta {
  screen: string;
  // The follow-up prompt the agent is offering as dim ghost text, "" when it offers none.
  // The phone cannot press Tab to accept it, so it is handed over as its own value for
  // the phone to offer as a chip (#563).
  suggestion: string;
  // The user's own saved phrases for this session (#830), already filtered to its kind.
  // Always present, `[]` when none apply — unlike the meta fields it is an array, so an
  // empty one is a fine thing to send and the phone needs no "is it there" check.
  // Kept OUT of SessionScreenMeta on purpose: definedScreenMeta trims its values, which
  // only makes sense for strings.
  quickCommands: QuickCommandChip[];
}

// A field the host can't answer is dropped entirely rather than sent as "": the response is
// written to a Firestore command doc, which rejects an `undefined` value outright, and the
// phone renders each field it receives as its own labelled row — an empty one would read as
// "this session has no branch" instead of "not known".
// What the host hands over BEFORE the trim: every field is a string it may not be able to
// answer. The trimmed result is a SessionScreenMeta, where an unanswered field has no key.
type ScreenMetaDraft = Partial<Record<keyof SessionScreenMeta, string | undefined>>;

export function definedScreenMeta(meta: ScreenMetaDraft): SessionScreenMeta {
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value.trim() !== ""));
}

// Where each field of the header comes from. Injected, like the rest of this file, so the join
// AND the order of the reads are testable without a PTY, a git checkout, or the server's
// module graph.
export interface ScreenMetaSources {
  cwdOf: (id: string) => string;
  // Both take the cwd, and neither is called for a session that has none — a dir the host
  // cannot name has no branch and no GitHub page either.
  branchOf: (cwd: string) => Promise<string | null>;
  githubUrlOf: (cwd: string) => Promise<string | null>;
  // The directory's icon as a src the phone can render, "" when it has none.
  iconOf: (cwd: string) => string;
  memoOf: (id: string) => string;
  summaryOf: (id: string) => string;
  promptOf: (id: string) => string;
  // The memo store's boot read. Awaited BEFORE memoOf, or a screen pulled during startup is
  // told the note is gone — which is indistinguishable from the user having erased it (#1110).
  memosHydrated: Promise<void>;
}

export async function buildScreenMeta(id: string, sources: ScreenMetaSources): Promise<SessionScreenMeta> {
  const cwd = sources.cwdOf(id);
  await sources.memosHydrated;
  // Both git reads are independent, so the phone waits for one spawn rather than two.
  const [branch, githubUrl] = await Promise.all([cwd ? sources.branchOf(cwd) : null, cwd ? sources.githubUrlOf(cwd) : null]);
  return definedScreenMeta({
    cwd,
    branch: branch ?? "",
    icon: cwd ? sources.iconOf(cwd) : "",
    memo: sources.memoOf(id),
    summary: sources.summaryOf(id),
    prompt: sources.promptOf(id),
    githubUrl: githubUrl ?? "",
  });
}

// tmux first: it renders the real screen, works while detached, and survives a restart.
// Falling back to the in-process buffer covers the tmux-less host, the non-persistent
// spawn, AND the race where the session ends between listing and reading.
const screenRowsOf = async (id: string, { captureStyledPane, sourceOf, render }: CaptureScreenDeps): Promise<ScreenRow[]> => {
  const captured = captureStyledPane(id);
  if (captured !== null) return parseStyledRows(captured);
  const source = sourceOf(id);
  if (!source) throw new Error(`terminal session '${id}' not found`);
  return render(source);
};

// The metadata decorates the screen, so a failure reading it (a git call that blew up, a dir
// that has since been deleted) costs those fields — never the terminal output itself.
const screenMetaOf = async (id: string, metaOf: CaptureScreenDeps["metaOf"]): Promise<SessionScreenMeta> => {
  if (!metaOf) return {};
  try {
    return definedScreenMeta(await metaOf(id));
  } catch {
    return {};
  }
};

// Reading the saved phrases must not cost the screen either — it is config, not output.
const quickCommandsOf = (id: string, read: CaptureScreenDeps["quickCommandsOf"]): QuickCommandChip[] => {
  if (!read) return [];
  try {
    return read(id);
  } catch {
    return [];
  }
};

// The blank rows below the last line are the unused part of the visible pane, not content.
// Dropped BEFORE the row cap, or a session using two lines of a 40-row pane would be sent a
// window of 262 real lines instead of 300. rowsToScreen already trimEnd()s them out of the
// string, so nothing about the screen the phone draws changes.
const withoutTrailingBlanks = (rows: readonly ScreenRow[]): readonly ScreenRow[] => rows.slice(0, rows.findLastIndex((row) => row.text.trim() !== "") + 1);

// The newest rows that fit in SCREEN_MAX_BYTES. Scanned from the bottom and stopped at the
// first row that doesn't fit: skipping an oversized row to keep smaller ones above it would
// hand the phone a window with a hole in it.
const withinByteCap = (rows: readonly ScreenRow[]): ScreenRow[] =>
  rows.reduceRight<{ kept: ScreenRow[]; bytes: number; full: boolean }>(
    (state, row) => {
      if (state.full) return state;
      const bytes = state.bytes + Buffer.byteLength(row.text, "utf8") + ROW_SEPARATOR_BYTES;
      if (bytes > SCREEN_MAX_BYTES) return { ...state, full: true };
      return { kept: [row, ...state.kept], bytes, full: false };
    },
    { kept: [], bytes: 0, full: false },
  ).kept;

// What the phone is shown, from whichever capture path produced the rows. Both paths are
// asked for the same history, but only this decides the window — otherwise a host with tmux
// and one without would answer the same session differently.
//
// Oldest-first is the only direction to drop in: the live prompt, the agent's ghost text and
// any menu the phone offers as chips are all at the bottom.
export const screenWindow = (rows: readonly ScreenRow[]): ScreenRow[] => withinByteCap(withoutTrailingBlanks(rows).slice(-SCREEN_HISTORY_ROWS));

export async function captureSessionScreen(id: string, deps: CaptureScreenDeps): Promise<SessionScreen> {
  // Concurrently: the meta read shells out to git, which is otherwise pure latency added to
  // every screen the phone pulls.
  const [rows, meta] = await Promise.all([screenRowsOf(id, deps), screenMetaOf(id, deps.metaOf)]);
  const windowRows = screenWindow(rows);
  return {
    screen: rowsToScreen(windowRows).trimEnd(),
    suggestion: suggestionFromRows(windowRows),
    quickCommands: quickCommandsOf(id, deps.quickCommandsOf),
    ...meta,
  };
}
