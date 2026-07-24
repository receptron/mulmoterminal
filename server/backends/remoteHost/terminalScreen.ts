// The session picker + screen read behind the phone's remote terminal view (#435).
//
// Both entry points are dependency-injected and free of server/index.ts internals, so the
// join rules and the capture fallback are unit-testable without a live PTY or tmux.
import { parseStyledRows, rowsToScreen, suggestionFromRows, type ScreenRow } from "../../session/screen-rows.js";

// What is running in a session, so the phone can offer input that suits it: shell
// command suggestions are useful in zsh and meaningless to an agent that reads prose
// (mulmoserver#84). Null when the host cannot tell — a session that outlived a restart
// exists only in tmux, and nothing recorded what launched it.
export type SessionAgent = "claude" | "codex" | "shell";

// Map a tmux pane's current command onto the kinds the phone knows. Anything else is a
// shell or a one-off program the phone has no special input for — "shell" is the right
// answer for both, since that is where typed commands belong.
const AGENT_COMMANDS: Record<string, SessionAgent> = { claude: "claude", codex: "codex" };

export const agentFromPaneCommand = (command: string | null): SessionAgent | null => {
  if (!command) {
    return null;
  }
  return AGENT_COMMANDS[command] ?? "shell";
};

export interface TerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  // A PTY is attached in THIS server process. False means the session exists only in tmux
  // (it outlived a restart) — still viewable, since capture-pane doesn't need our process.
  live: boolean;
  // What is running in it, or null when unknown (see SessionAgent). A tmux-only
  // session is always null: the process that knew is gone.
  agent: SessionAgent | null;
}

export interface SessionDetail {
  // Empty when the host has no name for this session — neither an AI-generated title
  // nor a recorded one. Such a session is dropped unless it is live (see below).
  title: string;
  cwd: string;
  agent: SessionAgent | null;
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
  detailOf: (id: string) => SessionDetail;
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
  return ids
    .map((id) => ({ id, ...detailOf(id), live: live.has(id) }))
    .filter((session) => session.title !== "" || session.live)
    .map((session) => ({ ...session, title: session.title || session.id }))
    .sort(byLiveThenTitle);
}

export interface ScreenSource {
  buffer: string;
  cols: number;
  rows: number;
}

export interface CaptureScreenDeps {
  captureStyledPane: (id: string) => string | null;
  sourceOf: (id: string) => ScreenSource | undefined;
  render: (input: ScreenSource) => Promise<ScreenRow[]>;
}

export interface SessionScreen {
  screen: string;
  // The follow-up prompt the agent is offering as dim ghost text, "" when it offers none.
  // The phone cannot press Tab to accept it, so it is handed over as its own value for
  // the phone to offer as a chip (#563).
  suggestion: string;
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

export async function captureSessionScreen(id: string, deps: CaptureScreenDeps): Promise<SessionScreen> {
  const rows = await screenRowsOf(id, deps);
  return { screen: rowsToScreen(rows).trimEnd(), suggestion: suggestionFromRows(rows) };
}
