import type { RunCommand } from "./runCommand";
import { isRecord } from "../../common/isRecord";

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
  // The agent this cell runs. "codex" / "antigravity"; absent = Claude (the default).
  agent?: "codex" | "antigravity";
}
// How the grid orders its cells. "manual": the user's hand-arranged order (the move buttons);
// "auto": attention-first, recomputed from each cell's live status; "priority": the rank each
// directory declares as `orderPriority` in its .mulmoterminal.json (#876).
export type SortMode = "manual" | "auto" | "priority";
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

// The uid of the trailing launch cell that "+ Terminal" (and the launcher's own close button)
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

// Record which agent a cell launched ("codex" / "antigravity"; Claude is the default/absent) so a
// reloaded cell reconnects to the right endpoint.
export function setCellAgent(state: GridState, uid: number, agent: "claude" | "codex" | "antigravity"): GridState {
  const cellAgent = agent === "claude" ? undefined : agent;
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, agent: cellAgent } : c)) };
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

// Walk the zoom one step along the on-screen `order` (dir -1 = previous, +1 = next).
// Stops at either end rather than wrapping.
//
// Refusing to act unless something is zoomed is what makes the `page` update below sound:
// while zoomed `visibleOrdered` returns the WHOLE ordered list, so an index into `order` is
// an index into the un-paged list. Un-zoomed, `order` is only the current page's slice and
// the same arithmetic would land on the wrong page.
export function moveZoom(state: GridState, order: readonly number[], dir: -1 | 1): GridState {
  const uid = zoomedUid(state);
  if (uid === null) return state;
  const from = order.indexOf(uid);
  if (from < 0) return state; // not on screen — without this, -1 + 1 would jump to the front
  const at = from + dir;
  const next = at >= 0 ? order[at] : undefined;
  if (next === undefined || !state.cells.some((c) => c.uid === next)) return state;
  return { ...state, expanded: next };
}

// ---------------------------------------------------------------------------------------
// ZOOM INVARIANTS (#829). Every one of these was broken at least once while building this,
// and each break looked like a different symptom, so they are written down rather than left
// to be re-derived. Anything added here must keep all five; the tests named "zoom invariants"
// in gridTabs.spec.ts and GridView.spec.ts fail loudly if not.
//
//  1. ONLY `toggleZoom` changes WHETHER the grid is zoomed. The movement actions (moveZoom,
//     nextAttention) relocate the enlargement or the page and never enter or leave the zoom.
//     A key that sometimes rearranges the whole layout is unpredictable to use.
//     (`closeCell` is the deliberate exception — closing the enlarged cell has to do
//     something about it, and it walks the zoom to a neighbour.)
//
//  2. `order` is ALWAYS the whole un-paged ordered list. Un-zoomed the grid renders only a
//     page of it, so passing that slice hides cells on other pages from the search AND makes
//     every index-to-page calculation below wrong.
//
//  3. `page` is decided at exactly ONE moment: releasing the zoom, from where the enlarged
//     cell sits. It is unused while zoomed (every cell renders, the tab bar is hidden), and
//     the page someone zoomed in FROM stops being true as soon as they walk the filmstrip.
//
//  4. There is ONE notion of "the current terminal": the enlarged cell while zoomed, the
//     focused cell otherwise. Never a second stored copy — a remembered uid and the live
//     focus disagree the moment the selection moves, and then expanding jumps somewhere the
//     user was not.
//
//  5. Entering the zoom needs two running cells (toggleExpand's rule, #374); LEAVING it is
//     never refused, whatever state the grid got into.
// ---------------------------------------------------------------------------------------

// Zoom `order[at]`, honouring invariant 5. Shared by every action that ENTERS the zoom so the
// rule cannot be forgotten at one entry point.
function zoomAt(state: GridState, order: readonly number[], at: number): GridState {
  const uid = order[at];
  if (uid === undefined || runningCount(state.cells) < 2) return state;
  if (!state.cells.some((c) => c.uid === uid)) return state;
  return { ...state, expanded: uid };
}

// Which page to show once the zoom is released: the one holding the cell that was enlarged.
//
// Derived HERE rather than carried along, because the page someone zoomed in from stops being
// true the moment they walk the filmstrip — after paging through terminals, "go back to where
// you started" lands them nowhere near what they were just reading. `page` is unused while
// zoomed (the grid renders every cell and the tab bar is hidden), so this is the only moment
// it has to be right.
const pageHolding = (order: readonly number[], uid: number, fallback: number): number => {
  const at = order.indexOf(uid);
  return at < 0 ? fallback : Math.floor(at / PAGE_SIZE);
};

// The keyboard's way in and out of the zoom (#829). Every other zoom action needs something
// already enlarged, so without this one a keymap cannot be used at all without first reaching
// for the expand button.
//
// Un-zoomed there is no "current" cell to enlarge, so it takes the first one ON THE PAGE THE
// USER IS LOOKING AT — `order` is the whole un-paged list, so index 0 would be a cell from the
// first tab, enlarging something off-screen and dragging the page back to 0 with it.
export function toggleZoom(state: GridState, order: readonly number[], fromUid: number | null = null): GridState {
  const uid = zoomedUid(state);
  if (uid !== null) return { ...state, expanded: null, page: pageHolding(order, uid, state.page) };
  // Enlarge whatever is SELECTED — the focused cell, which the caller supplies because only it
  // knows where the cursor is. There is deliberately no separate "last enlarged" memory: it
  // would fight the live selection, so collapsing and re-expanding would jump somewhere else.
  const at = fromUid !== null ? order.indexOf(fromUid) : -1;
  return zoomAt(state, order, at >= 0 ? at : state.page * PAGE_SIZE);
}

// Search order for "somewhere worth going": the two states that are actually calling —
// `blocked` (needs an answer now) then `done` (finished, unreviewed) — and `idle` as a
// fallback, so the key still moves on a board where nothing happens to be waiting.
//
// `working` is deliberately absent: a cell mid-turn is the one place the user has no reason to
// be, and skipping it is what stops this from being a plain "next cell". This mirrors the
// attention RANK the "auto" sort already uses, where idle likewise outranks working.
const ATTENTION_ORDER: readonly CellStatus[] = ["blocked", "done", "idle"];

// Jump to the next terminal that wants the user, cycling from wherever the zoom is now — the
// "take me to whoever called" key. Also works un-zoomed, where it doubles as a way in.
//
// Wraps deliberately: this is a round of pending cells, not a list with ends, so pressing it
// repeatedly walks all of them and comes back rather than stopping on the last.
export function nextAttention(state: GridState, order: readonly number[], statusByUid: Record<number, CellStatus>, fromUid: number | null = null): GridState {
  const at = nextCandidate(state, order, statusByUid, zoomedUid(state) ?? fromUid);
  if (at === undefined) return state;
  // NEVER enlarges or collapses — that is toggleZoom's job alone. Zoomed, this moves which
  // terminal is enlarged; un-zoomed, it brings the candidate's page on screen and leaves the
  // grid a grid. A key that sometimes changed the whole layout would be unpredictable.
  return zoomedUid(state) !== null ? { ...state, expanded: order[at] } : { ...state, page: Math.floor(at / PAGE_SIZE) };
}

/** The uid of the terminal `nextAttention` would move to, or null. Exported so the caller can
 *  also put the cursor there — in a plain grid that focus IS the visible "you are here". */
export function nextAttentionUid(
  state: GridState,
  order: readonly number[],
  statusByUid: Record<number, CellStatus>,
  fromUid: number | null = null,
): number | null {
  const at = nextCandidate(state, order, statusByUid, zoomedUid(state) ?? fromUid);
  return at === undefined ? null : order[at];
}

// The index in `order` of the next terminal worth going to, starting after `from`, or undefined
// when there is none.
//
// `from` matters more than it looks: without it the rotation always begins at index 0, so every
// press picks the same first candidate and the key appears dead after the first one. Zoomed,
// that origin is the enlarged cell; un-zoomed it has to be the focused one, which only the
// caller knows.
function nextCandidate(state: GridState, order: readonly number[], statusByUid: Record<number, CellStatus>, fromUid: number | null): number | undefined {
  if (order.length === 0) return undefined;
  const from = order.indexOf(fromUid ?? -1); // -1 when nothing is current => search starts at 0
  const rotated = order.map((_, i) => (from + 1 + i) % order.length);
  // The empty launch cell is not a terminal, so it is never somewhere to send anyone — and it
  // would otherwise be picked constantly, since a cell with no reported status reads as `idle`
  // below and a launcher never reports one. countByStatus skips it for the same reason.
  const occupied = new Set(state.cells.filter(isOccupied).map((c) => c.uid));
  for (const status of ATTENTION_ORDER) {
    // Absent = idle, the convention CellStatus documents: a cell whose status has not been
    // reported yet must not fall out of the search entirely.
    const at = rotated.find((i) => occupied.has(order[i]) && (statusByUid[order[i]] ?? "idle") === status);
    if (at !== undefined) return at;
  }
  return undefined;
}

// Zooming shows one cell big with the others as a filmstrip beside it, so it only means
// anything when there IS another cell to switch to. With a single occupied cell the expand button
// used to swap a working layout for a filmstrip containing nothing, and squeeze the
// terminal's status bar and input off the bottom of the viewport for no gain (#374).
//
// Collapsing is never refused: whatever a state got into, ⤡ has to get out of it.
export function toggleExpand(state: GridState, uid: number, order: readonly number[] = []): GridState {
  if (state.expanded === uid) return { ...state, expanded: null, page: pageHolding(order, uid, state.page) };
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

// A directory that sets no `orderPriority` sorts after every directory that does, so adding the
// key to ONE project doesn't displace all the others. Infinity rather than a big sentinel: no
// integer a user could write should be able to outrank "unset".
const UNSET_PRIORITY = Number.POSITIVE_INFINITY;
const cellPriority = (c: Cell, priorityByCwd: Record<string, number>): number => (c.cwd ? (priorityByCwd[c.cwd] ?? UNSET_PRIORITY) : UNSET_PRIORITY);

// Display order. "manual": the hand-arranged list as-is. "auto": a STABLE sort by
// attention rank — equal-rank cells keep their manual order, so a status change
// only floats that one cell to its bucket and doesn't reshuffle the rest.
// "priority": the same stable shape, keyed on each directory's declared rank instead.
//
// Empty launch cells are held last by their own comparison level rather than by their key:
// in "priority" every unset directory already keys to Infinity, so a key alone could not put
// a launch cell after them. ("auto" reaches the same place via LAUNCH_RANK — this level is
// what makes the two modes agree instead of coinciding.)
export function orderCells(cells: Cell[], statusByUid: Record<number, CellStatus>, mode: SortMode, priorityByCwd: Record<string, number> = {}): Cell[] {
  if (mode === "manual") return cells;
  const key = mode === "priority" ? (c: Cell) => cellPriority(c, priorityByCwd) : (c: Cell) => cellRank(c, statusByUid);
  const launchesLast = (c: Cell) => (isLaunchCell(c) ? 1 : 0);
  return cells
    .map((c, i) => ({ c, i }))
    .sort((a, b) => launchesLast(a.c) - launchesLast(b.c) || key(a.c) - key(b.c) || a.i - b.i)
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
//
// `priorityByCwd` is the same requirement for the "priority" mode, and it is a parameter
// rather than an omission for a reason: defaulted to {} every directory reads as unset, so a
// caller that forgot it would order priority mode differently from the grid — the exact drift
// #720 exists to prevent.
export const visibleOrdered = (state: GridState, statusByUid: Record<number, CellStatus>, priorityByCwd: Record<string, number> = {}): Cell[] => {
  const ordered = orderCells(state.cells, statusByUid, state.sortMode, priorityByCwd);
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
// Anything unrecognised falls back to "manual" — including a mode written by a NEWER build
// that this one doesn't know, where the hand-arranged order is the safe thing to show.
const asSortMode = (v: unknown): SortMode => (v === "auto" || v === "priority" ? v : "manual");
// Keep a persisted launcher only if well-formed; anything else drops to null so a
// reloaded cell reconnects as a plain (Claude) session instead of a broken launcher.
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
      agent: c.agent === "codex" ? "codex" : c.agent === "antigravity" ? "antigravity" : undefined,
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
