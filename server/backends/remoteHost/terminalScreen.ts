// The session picker + screen read behind the phone's remote terminal view (#435).
//
// Both entry points are dependency-injected and free of server/index.ts internals, so the
// join rules and the capture fallback are unit-testable without a live PTY or tmux.
export interface TerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  // A PTY is attached in THIS server process. False means the session exists only in tmux
  // (it outlived a restart) — still viewable, since capture-pane doesn't need our process.
  live: boolean;
}

export interface SessionDetail {
  title: string;
  cwd: string;
}

export interface SessionListInput {
  liveIds: readonly string[];
  tmuxIds: readonly string[];
  // Excludes sessions an orphan cleanup would reap — without it the picker fills with
  // long-dead tmux shells (66 of them on the author's machine when this was written).
  isResumable: (id: string) => boolean;
  detailOf: (id: string) => SessionDetail;
}

// Live sessions first, then by title, so the phone's list is stable across polls.
const byLiveThenTitle = (a: TerminalSessionSummary, b: TerminalSessionSummary): number =>
  a.live === b.live ? a.title.localeCompare(b.title) : Number(b.live) - Number(a.live);

export function buildSessionList({ liveIds, tmuxIds, isResumable, detailOf }: SessionListInput): TerminalSessionSummary[] {
  const live = new Set(liveIds);
  const ids = [...new Set([...liveIds, ...tmuxIds])].filter(isResumable);
  return ids.map((id) => ({ id, ...detailOf(id), live: live.has(id) })).sort(byLiveThenTitle);
}

export interface ScreenSource {
  buffer: string;
  cols: number;
  rows: number;
}

export interface CaptureScreenDeps {
  capturePane: (id: string) => string | null;
  sourceOf: (id: string) => ScreenSource | undefined;
  render: (input: ScreenSource) => Promise<string>;
}

// tmux first: it renders the real screen, works while detached, and survives a restart.
// Falling back to the in-process buffer covers the tmux-less host, the non-persistent
// spawn, AND the race where the session ends between listing and reading.
export async function captureSessionScreen(id: string, { capturePane, sourceOf, render }: CaptureScreenDeps): Promise<string> {
  const captured = capturePane(id);
  if (captured !== null) return captured.trimEnd();
  const source = sourceOf(id);
  if (!source) throw new Error(`terminal session '${id}' not found`);
  return render(source);
}
