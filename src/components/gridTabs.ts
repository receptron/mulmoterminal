import type { RunCommand } from "./runCommand";

// The grid is ONE flat, ordered list of terminal cells, split into pages of 9
// (the tabs). Closing a cell reflows the whole list so later pages pack forward
// into the gap (terminals flow across page boundaries); "+ Terminal" appends a
// launch cell, overflowing into a new page when the last one is full. GridView
// owns a single GridState ref and drives it through these pure transforms;
// TerminalGrid just renders the active page's slice.

// A configured launch command (shell/codex/…) running in a cell. `index` is its
// position in the user's launcher list (the server's allowlist); `label` is kept for
// display and to re-launch after a server restart. `{ shell: true }` is the OS default
// shell ($SHELL) opened by the header "new terminal" button — no configured index.
// Unlike a command, a launcher cell IS persisted (it has a session and reconnects).
export type CellLauncher = { index: number; label: string } | { shell: true; label: string };
export const isShellLauncher = (l: CellLauncher): l is { shell: true; label: string } => "shell" in l;
// A fresh OS-default-shell cell (session arrives from the server, then it persists/reconnects).
export const shellCell = (cwd: string, label = "shell"): Omit<Cell, "uid"> => ({ session: null, cwd, launcher: { shell: true, label } });

export interface Cell {
  uid: number;
  session: string | null;
  cwd: string | null;
  // A running command cell (a script.json entry or a header shell button), with the
  // directory it runs in. Ephemeral — command cells are never persisted.
  command?: RunCommand | null;
  // A running launcher (shell/codex/custom). Persistent & reattachable like a session.
  launcher?: CellLauncher | null;
  // The agent this cell runs. "codex" reconnects via /ws/codex; absent = Claude (the default).
  agent?: "codex";
}
// How the grid orders its cells. "manual": the user's hand-arranged order (◀▶);
// "auto": attention-first, recomputed from each cell's live status.
export type SortMode = "manual" | "auto";
// A cell's live activity, reported up from the cell. Drives the "auto" order and the
// cell's color/label. `blocked` (needs input/permission) and `done` (finished a turn,
// output unreviewed) both come from the server's `waiting` flag, split by which hook
// set it. Absent uids are treated as idle.
export type CellStatus = "blocked" | "done" | "working" | "idle";

// Map the server's raw activity to a CellStatus. `waiting` means "needs the user";
// the `event` that set it distinguishes a permission/question pause ("Notification"
// → blocked, most urgent) from a finished-but-unreviewed turn ("Stop" → done).
export function activityStatus(working: boolean, waiting: boolean, event: string | null | undefined): CellStatus {
  if (waiting) return event === "Notification" ? "blocked" : "done";
  if (working) return "working";
  return "idle";
}

export interface GridState {
  cells: Cell[];
  expanded: number | null; // uid of the zoomed cell, or null
  page: number;
  nextUid: number;
  sortMode: SortMode;
}

export const PAGE_SIZE = 9;
export const MAX_TERMINALS = 81; // 9 pages
export const STATE_KEY = "grid_v2";
export const LEGACY_KEY = "grid_state_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pageCount = (cellCount: number) => Math.max(1, Math.ceil(cellCount / PAGE_SIZE));
export const pageSlice = <T>(cells: T[], page: number) => cells.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
// A cell occupies a slot when it runs a Claude session, a command, OR a launcher; only
// those count toward the cap. A launch cell is empty: no session, command, or launcher.
const isOccupied = (c: Cell) => c.session !== null || c.command != null || c.launcher != null;
const isLaunchCell = (c: Cell | undefined) => !!c && c.session === null && c.command == null && c.launcher == null;
export const runningCount = (cells: Cell[]) => cells.filter(isOccupied).length;

const clampPage = (s: GridState): GridState => ({ ...s, page: Math.min(Math.max(0, Math.floor(s.page)), pageCount(s.cells.length) - 1) });

// Always keep at least one cell — the entry launch cell on an otherwise empty grid.
const ensureEntry = (s: GridState): GridState =>
  s.cells.length > 0 ? s : { ...s, cells: [{ uid: s.nextUid, session: null, cwd: null }], nextUid: s.nextUid + 1 };

// "+ Terminal": append a launch cell (overflowing into a new page when full), or
// cancel an already-open launch cell. The sole entry cell is never removed.
export function addCell(state: GridState): GridState {
  const last = state.cells[state.cells.length - 1];
  if (isLaunchCell(last)) {
    if (state.cells.length <= 1) return state; // the entry cell — nothing to add or cancel
    return clampPage({ ...state, cells: state.cells.slice(0, -1) }); // cancel the open launch cell
  }
  if (runningCount(state.cells) >= MAX_TERMINALS) return state;
  const uid = state.nextUid;
  const cells = [...state.cells, { uid, session: null, cwd: null }];
  // While a cell is zoomed, promote the new one into the enlarged view so the user
  // launches it there rather than hunting for it in the filmstrip.
  const expanded = zoomedUid(state) !== null ? uid : state.expanded;
  return { ...state, cells, nextUid: state.nextUid + 1, page: pageCount(cells.length) - 1, expanded };
}

// The uid of the trailing launch cell that "+ Terminal" (and the launcher's own ✕)
// cancels, or null when there's nothing to cancel. The sole entry cell is never
// cancelable, so it's excluded.
export function cancelableLaunchUid(state: GridState): number | null {
  const last = state.cells[state.cells.length - 1];
  return state.cells.length > 1 && isLaunchCell(last) ? last.uid : null;
}

export function setSession(state: GridState, uid: number, id: string | null): GridState {
  const cells = state.cells.map((c) => (c.uid === uid ? { ...c, session: id } : c));
  const expanded = id === null && state.expanded === uid ? null : state.expanded;
  return { ...state, cells, expanded };
}

export function setCwd(state: GridState, uid: number, cwd: string): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, cwd } : c)) };
}

// Record which agent a cell launched (only "codex" is stored; Claude is the default/absent) so a
// reloaded cell reconnects to the right endpoint.
export function setCellAgent(state: GridState, uid: number, agent: "claude" | "codex"): GridState {
  const codex: "codex" | undefined = agent === "codex" ? "codex" : undefined;
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, agent: codex } : c)) };
}

// A cell's launcher ran a script.json command: attach it, turning the launch cell
// into a command terminal. Ephemeral — command cells aren't persisted.
export function runCommand(state: GridState, uid: number, command: Cell["command"]): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, command } : c)) };
}

// A cell launched a configured program (shell/codex/…): attach the launcher and its
// directory, turning the launch cell into a persistent launcher terminal. Its session
// id arrives later from the server (setSession), so it persists and reconnects.
export function launchInCell(state: GridState, uid: number, launcher: CellLauncher, cwd: string | null): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, launcher, cwd } : c)) };
}

// Insert a brand-new cell immediately AFTER the cell that triggered it, so the header
// "new terminal" button and the Run button open next to the current cell rather than at
// the end. Falls back to appending when `afterUid` is gone. Jumps to the new cell's page.
export function insertCellAfter(state: GridState, afterUid: number, cell: Omit<Cell, "uid">): GridState {
  if (runningCount(state.cells) >= MAX_TERMINALS) return state;
  const idx = state.cells.findIndex((c) => c.uid === afterUid);
  const at = idx >= 0 ? idx + 1 : state.cells.length;
  const uid = state.nextUid;
  const cells = [...state.cells.slice(0, at), { ...cell, uid }, ...state.cells.slice(at)];
  const expanded = zoomedUid(state) !== null ? uid : state.expanded;
  return { ...state, cells, nextUid: state.nextUid + 1, page: Math.floor(at / PAGE_SIZE), expanded };
}

// The Run button opened a script in a spare cell next to the cell that triggered it.
export function runScriptInNewCell(state: GridState, afterUid: number, command: NonNullable<Cell["command"]>): GridState {
  return insertCellAfter(state, afterUid, { session: null, cwd: null, command });
}

// Close a cell: drop it and reflow the list (later cells pack forward across
// pages), keep an entry cell, and clamp the page. If the CLOSED cell was the zoomed
// one, STAY zoomed on its neighbour in the on-screen `order` — the previous cell, or
// the next one when the closed cell was first — so closing walks the expand along the
// filmstrip instead of collapsing to the grid. Falls back to un-zooming when there's
// no surviving neighbour (the last cell) or no `order` is supplied.
export function closeCell(state: GridState, uid: number, order?: number[]): GridState {
  const cells = state.cells.filter((c) => c.uid !== uid);
  const expanded = state.expanded === uid ? expandNeighbour(order, uid, cells) : state.expanded;
  return ensureEntry(clampPage({ ...state, cells, expanded }));
}

// The uid to keep zoomed after closing the zoomed `uid`: the cell before it in the
// on-screen `order`, or the one after when it was first. null (collapse to the grid)
// when there's no surviving neighbour or no order was given.
function expandNeighbour(order: number[] | undefined, uid: number, remaining: Cell[]): number | null {
  if (!order) return null;
  const idx = order.indexOf(uid);
  if (idx < 0) return null;
  const neighbour = idx > 0 ? order[idx - 1] : order[idx + 1];
  return neighbour !== undefined && remaining.some((c) => c.uid === neighbour) ? neighbour : null;
}

// Zooming shows one cell big with the others as a filmstrip beside it, so it only means
// anything when there IS another cell to switch to. With a single occupied cell the ⤢ button
// used to swap a working layout for a filmstrip containing nothing, and squeeze the
// terminal's status bar and input off the bottom of the viewport for no gain (#374).
//
// Collapsing is never refused: whatever a state got into, ⤡ has to get out of it.
export function toggleExpand(state: GridState, uid: number): GridState {
  if (state.expanded === uid) return { ...state, expanded: null };
  if (runningCount(state.cells) < 2) return state;
  return { ...state, expanded: uid };
}

export function setSortMode(state: GridState, sortMode: SortMode): GridState {
  return { ...state, sortMode };
}

// Whether moveCell would actually reorder: not off either end, and never swapping a cell past
// the trailing launch cell (it stays last so "+ Terminal"/cancel keep working on it). Drives the
// enabled/disabled state of the roster's up/down menu items.
export function canMoveCell(cells: Cell[], uid: number, dir: -1 | 1): boolean {
  const i = cells.findIndex((c) => c.uid === uid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cells.length) return false;
  return !(isLaunchCell(cells[j]) && j === cells.length - 1);
}

// Manual reorder: swap a cell with its neighbour (dir -1 = left/up, +1 = right/down) in the
// flat list. A no-op wherever canMoveCell says the swap isn't allowed.
export function moveCell(state: GridState, uid: number, dir: -1 | 1): GridState {
  if (!canMoveCell(state.cells, uid, dir)) return state;
  const i = state.cells.findIndex((c) => c.uid === uid);
  const cells = state.cells.slice();
  [cells[i], cells[i + dir]] = [cells[i + dir], cells[i]];
  return { ...state, cells };
}

// The zoomed cell's uid, or null when nothing is zoomed (or `expanded` is stale —
// points at a cell no longer in the list).
export const zoomedUid = (state: GridState): number | null =>
  state.expanded !== null && state.cells.some((c) => c.uid === state.expanded) ? state.expanded : null;

// Attention-first rank for the "auto" order: blocked (needs input now) first, then
// done (finished, review it), then idle, then working, with empty launch cells last.
// Lower sorts earlier.
const RANK: Record<CellStatus, number> = { blocked: 0, done: 1, idle: 2, working: 3 };
const LAUNCH_RANK = 4;
const cellRank = (c: Cell, statusByUid: Record<number, CellStatus>): number => (isLaunchCell(c) ? LAUNCH_RANK : RANK[statusByUid[c.uid] ?? "idle"]);

// Display order. "manual": the hand-arranged list as-is. "auto": a STABLE sort by
// attention rank — equal-rank cells keep their manual order, so a status change
// only floats that one cell to its bucket and doesn't reshuffle the rest.
export function orderCells(cells: Cell[], statusByUid: Record<number, CellStatus>, mode: SortMode): Cell[] {
  if (mode !== "auto") return cells;
  return cells
    .map((c, i) => ({ c, i }))
    .sort((a, b) => cellRank(a.c, statusByUid) - cellRank(b.c, statusByUid) || a.i - b.i)
    .map((x) => x.c);
}

// Cells in the on-screen view, in manual (base) order: while a cell is zoomed, the
// WHOLE list (so the filmstrip lines up every tab's terminal, live), otherwise just
// the active page's slice.
export const visibleCells = (state: GridState): Cell[] => (zoomedUid(state) !== null ? state.cells : pageSlice(state.cells, state.page));

// The cells to render. "auto" attention-sorts the WHOLE list first, then pages — so a
// waiting cell from any page floats onto the first page. This needs a status map that
// covers EVERY cell (incl. unmounted pages), or a status change on an off-screen page
// would (mis)read as idle; GridView feeds it the server's full session status. While
// zoomed the whole ordered list is shown (the filmstrip).
export const visibleOrdered = (state: GridState, statusByUid: Record<number, CellStatus>): Cell[] => {
  const ordered = orderCells(state.cells, statusByUid, state.sortMode);
  return zoomedUid(state) !== null ? ordered : pageSlice(ordered, state.page);
};

export type StatusCounts = Record<CellStatus, number>;

// Tally occupied cells (a running session or command) by status — empty launchers are
// skipped. Powers the toolbar's at-a-glance "N need you" summary across ALL pages.
export function countByStatus(cells: Cell[], statusByUid: Record<number, CellStatus>): StatusCounts {
  const counts: StatusCounts = { blocked: 0, done: 0, working: 0, idle: 0 };
  for (const c of cells) {
    if (isLaunchCell(c)) continue;
    counts[statusByUid[c.uid] ?? "idle"]++;
  }
  return counts;
}

// Switch page: drop an abandoned trailing launch cell first and clear the zoom
// (zoom is scoped to a page). Selecting the already-active page is a no-op so it
// doesn't discard the open launch cell or zoom.
export function switchPage(state: GridState, page: number): GridState {
  if (page === state.page) return state;
  const last = state.cells[state.cells.length - 1];
  const cells = isLaunchCell(last) && state.cells.length > 1 ? state.cells.slice(0, -1) : state.cells;
  return clampPage({ ...state, cells, expanded: null, page });
}

const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
const asSortMode = (v: unknown): SortMode => (v === "auto" ? "auto" : "manual");
// Keep a persisted launcher only if well-formed; anything else drops to null so a
// reloaded cell reconnects as a plain (Claude) session instead of a broken launcher.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asLauncher = (v: unknown): CellLauncher | null => {
  if (!isRecord(v) || typeof v.label !== "string") return null;
  if (v.shell === true) return { shell: true, label: v.label };
  return typeof v.index === "number" && Number.isInteger(v.index) && v.index >= 0 ? { index: v.index, label: v.label } : null;
};
// A cell entry is kept if its session/cwd are well-formed; uid is validated only to
// match the persisted `expanded` (it is renumbered below regardless).
const isCell = (c: unknown): c is Cell => {
  const o = c as Cell | null;
  return !!o && (o.session === null || isUuid(o.session)) && (o.cwd === null || typeof o.cwd === "string");
};

export function parseGridState(raw: string | null): GridState | null {
  try {
    const parsed = JSON.parse(raw ?? "");
    if (!Array.isArray(parsed?.cells)) return null;
    // Keep only running cells (the trailing launch cell is ephemeral) and renumber
    // uids from position. Persisted uids are untrusted: duplicates would collide
    // v-for keys, and a near-MAX_SAFE_INTEGER value would overflow the nextUid
    // counter. uid is internal identity only, so a clean 0..n-1 space (nextUid =
    // count) is always safe and in range.
    const running = parsed.cells
      .filter(isCell)
      .filter((c: Cell) => c.session !== null)
      .slice(0, MAX_TERMINALS);
    const cells: Cell[] = running.map((c: Cell, i: number) => ({
      uid: i,
      session: c.session,
      cwd: c.cwd,
      launcher: asLauncher(c.launcher),
      agent: c.agent === "codex" ? "codex" : undefined,
    }));
    const expandedIdx = running.findIndex((c: Cell) => c.uid === parsed.expanded);
    const expanded = typeof parsed.expanded === "number" && expandedIdx >= 0 ? expandedIdx : null;
    const page = Number.isSafeInteger(parsed.page) && parsed.page >= 0 ? parsed.page : 0;
    return clampPage(ensureEntry({ cells, expanded, page, nextUid: cells.length, sortMode: asSortMode(parsed.sortMode) }));
  } catch {
    return null;
  }
}

// Migrate the legacy single-grid shape ({ sessions, cwds, expanded:position }).
export function migrateLegacy(raw: string | null): GridState | null {
  try {
    const parsed = JSON.parse(raw ?? "");
    if (!Array.isArray(parsed?.sessions)) return null;
    const cells: Cell[] = [];
    parsed.sessions.forEach((s: unknown, i: number) => {
      if (isUuid(s)) cells.push({ uid: cells.length, session: s, cwd: typeof parsed.cwds?.[i] === "string" ? parsed.cwds[i] : null });
    });
    const expanded = typeof parsed.expanded === "number" && parsed.expanded >= 0 && parsed.expanded < cells.length ? cells[parsed.expanded].uid : null;
    return clampPage(ensureEntry({ cells, expanded, page: 0, nextUid: cells.length, sortMode: "manual" }));
  } catch {
    return null;
  }
}

export function initialState(curRaw: string | null, legacyRaw: string | null): { state: GridState; migrated: boolean } {
  const cur = parseGridState(curRaw);
  if (cur) return { state: cur, migrated: false };
  const migrated = migrateLegacy(legacyRaw);
  if (migrated) return { state: migrated, migrated: true };
  return { state: ensureEntry({ cells: [], expanded: null, page: 0, nextUid: 0, sortMode: "manual" }), migrated: false };
}

// Which status a cell sorts and tallies by.
//
// The precedence is the rule: the server's activity for the cell's SESSION wins, because it
// is the only source that knows a turn is blocked. A cell's own reported status is the
// fallback — command cells have no session id, and a just-launched cell has none yet — and
// idle is the floor.
//
// This feeds orderCells and countByStatus, so getting it backwards is not cosmetic: in auto
// mode a blocked cell on page 3 stops floating to page 1, which is the entire point of that
// mode, and the toolbar's "needs you" tally goes with it.
export function resolveCellStatus(
  cells: readonly { uid: number; session: string | null }[],
  bySession: ReadonlyMap<string, CellStatus>,
  byUid: Readonly<Record<number, CellStatus>>,
): Record<number, CellStatus> {
  const out: Record<number, CellStatus> = {};
  for (const cell of cells) {
    const fromSession = cell.session ? bySession.get(cell.session) : undefined;
    out[cell.uid] = fromSession ?? byUid[cell.uid] ?? "idle";
  }
  return out;
}

// The toolbar's grid-wide, at-a-glance tally. Two decisions, and the asymmetry is deliberate:
//
// The badge shows only when something is actually RUNNING — blocked + done + working > 0.
// Idle is NOT counted there: a grid of nothing but idle cells has nothing to triage, and
// surfacing the strip on every quiet session is noise. But idle IS in the tooltip text, as
// the trailing part, because once the strip is up "how many are idle" is useful context.
//
// Order is fixed: blocked (needs you) first, then done, working, idle — the reading order for
// deciding which cell to look at.
export interface GridStatusSummary {
  show: boolean;
  title: string;
}

export function gridStatusSummary(counts: StatusCounts | null | undefined): GridStatusSummary {
  if (!counts) return { show: false, title: "" };
  const parts: string[] = [];
  if (counts.blocked) parts.push(`${counts.blocked} need input`);
  if (counts.done) parts.push(`${counts.done} done (review)`);
  if (counts.working) parts.push(`${counts.working} working`);
  if (counts.idle) parts.push(`${counts.idle} idle`);
  return { show: counts.blocked + counts.done + counts.working > 0, title: parts.join(" · ") };
}
