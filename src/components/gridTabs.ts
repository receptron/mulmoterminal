import { isRemoteHostId } from "../../common/remoteHosts";
import type { RunCommand } from "./runCommand";
import type { Translate } from "../i18n/translate";
import type { LaunchChoice } from "./wsUrl";
import { dirPriority } from "../../common/dirPriorityOrder";
import { asTerminalAgent, type BadgedAgent, type TerminalAgent } from "../../common/sessionAgent";
import { isCustomAgentId } from "../../common/customAgents";
import { isAccountId } from "../../common/agentAccounts";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import type { AttentionStatus } from "./attentionStatus";

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
// One name for a shell cell, so the launch form's Shell option and the header's new-terminal
// button read the same in the grid.
const SHELL_LAUNCHER_LABEL = "shell";
export const shellLauncher = (): CellLauncher => ({ shell: true, label: SHELL_LAUNCHER_LABEL });
// A fresh OS-default-shell cell (session arrives from the server, then it persists/reconnects).
export const shellCell = (cwd: string | null): Omit<Cell, "uid"> => ({ session: null, cwd, launcher: shellLauncher() });

// A cell for a session spawned ELSEWHERE and adopted here, which must carry the agent: without the
// flag the cell reconnects on Claude's endpoint, so a codex session would attach as claude. Claude
// records NO key — under exactOptionalPropertyTypes an explicit `agent: undefined` is a different
// thing from an absent one, and only the absent one survives the JSON a persisted cell round-trips.
export const sessionCell = (session: string, cwd: string | null, agent: TerminalAgent): Omit<Cell, "uid"> =>
  agent === "claude" ? { session, cwd } : { session, cwd, agent };

// A row of /api/sessions/unplaced as the cell that adopts it. "shell" is a bot job's shell
// (server/backends/botJobs): it reattaches as a Shell cell, on the launcher endpoint — read as an
// agent it would fall to Claude and start Claude in its place. Anything else is an agent, and an
// unknown value is Claude, as asTerminalAgent decides everywhere.
export const unplacedCell = (session: string, cwd: string | null, kind: unknown): Omit<Cell, "uid"> =>
  kind === "shell" ? { session, cwd, launcher: shellLauncher() } : sessionCell(session, cwd, asTerminalAgent(kind));

export interface Cell {
  uid: number;
  session: string | null;
  cwd: string | null;
  // A running command cell (a script.json entry or a header shell button), with the
  // directory it runs in. Ephemeral — command cells are never persisted.
  command?: RunCommand | null | undefined;
  // A running launcher (shell/codex/custom). Persistent & reattachable like a session.
  launcher?: CellLauncher | null;
  // The agent this cell runs; absent = Claude (the default), which is why the union excludes it
  // rather than listing the others — a fifth agent reaches every cell site by adding itself to
  // TERMINAL_AGENTS, and cannot be half-added by someone updating one of these lists.
  agent?: BadgedAgent;
  // The custom-agent entry this cell was launched from (common/customAgents.ts), or absent for a
  // built-in. It rides ALONGSIDE `agent`, which stays "claude" for a custom one — a wrapper decides
  // which command line starts Claude Code, not what the session is. Needed on the cell because the
  // launch panel creates the cell from outside it, so the pick cannot live only in TerminalCell.
  customAgent?: string;
  // The account (a second login, #2215) this cell's session runs on, or absent for the default.
  // Kept across a reload so the header can keep saying which login it is; the SERVER is what holds
  // the session to it, so a stale value here can mislabel a cell but never move its conversation.
  account?: string;
  // The remote host this cell's terminal runs on (#3506), or absent for this machine. Fixed for the
  // cell's life: what it decides (src/components/remoteCell.ts) must not change under a live session.
  remoteHost?: string;
  // Set aside by the user: still connected and still holding its history, just sunk out of the
  // way (#992). Stored as the ABSENCE of the key when not parked, for the same reason `agent`
  // is — only an absent key survives the JSON a persisted cell round-trips.
  parked?: true;
  // Start `agent` in `cwd` as soon as the cell mounts, instead of opening the launcher form for
  // someone to press Start. The phone's launch request (#831) is the only thing that sets it: the
  // grid has to say WHAT the cell runs, because a fresh agent launch is otherwise a local
  // transition inside TerminalCell and the grid learns of it only when the session id arrives.
  //
  // One-shot: `setSession` drops it once the cell has answered. It never survives a RELOAD either
  // — parseGridState rebuilds each cell field by field and does not carry it — though, like every
  // other in-flight field, it is written to localStorage in the meantime rather than stripped.
  autoStart?: true;
  // The provider/model the launch form picked for the session this cell is about to start (#584).
  // One-shot and NOT restored, exactly like `autoStart`: it describes a launch in flight, and a
  // reloaded cell either has a session already or is back at the form where the pick is made again.
  //
  // On the cell because the launch PANEL is outside it (#1867) — while the form lived in the cell,
  // the pick never had to leave TerminalCell's own state.
  launchChoice?: LaunchChoice;
}
// How the grid orders its cells. "manual": the user's hand-arranged order (the move buttons);
// "auto": attention-first, recomputed from each cell's live status; "priority": the rank each
// directory declares as `orderPriority` in its .mulmoterminal.json (#876).
export type SortMode = "manual" | "auto" | "priority";
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
// those count toward the cap. A cell told to auto-start counts too, in the window before its
// session id arrives: it is about to run, and `switchPage` discards a trailing LAUNCH cell.
// A launch cell is the other side of that — the empty launcher, waiting to be told what to run.
export const isOccupied = (c: Cell) => c.session !== null || c.command != null || c.launcher != null || c.autoStart === true;
const isLaunchCell = (c: Cell | undefined) => !!c && !isOccupied(c);
export const runningCount = (cells: Cell[]) => cells.filter(isOccupied).length;

const clampPage = (s: GridState): GridState => ({ ...s, page: Math.min(Math.max(0, Math.floor(s.page)), pageCount(s.cells.length) - 1) });

// Always keep at least one cell — the entry launch cell on an otherwise empty grid.
const ensureEntry = (s: GridState): GridState =>
  s.cells.length > 0 ? s : { ...s, cells: [{ uid: s.nextUid, session: null, cwd: null }], nextUid: s.nextUid + 1 };

export function setSession(state: GridState, uid: number, id: string | null): GridState {
  // Drop the one-shot auto-start flag: the cell has answered. Left set, a cell whose session is
  // later closed would keep counting as occupied while sitting on the launcher form.
  const started = ({ autoStart: _consumed, ...rest }: Cell): Cell => ({ ...rest, session: id });
  const cells = state.cells.map((c) => (c.uid === uid ? started(c) : c));
  const expanded = id === null && state.expanded === uid ? null : state.expanded;
  return { ...state, cells, expanded };
}

export function setCwd(state: GridState, uid: number, cwd: string): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, cwd } : c)) };
}

// Claude is stored as the ABSENCE of the field, so a cell written before the field existed and a
// cell running Claude are the same thing on disk. Used when READING a persisted cell; the writer
// below has to go further and drop the key entirely.
export const storedCellAgent = (agent: TerminalAgent): Cell["agent"] => (agent === "claude" ? undefined : agent);

// Record which agent a cell launched, so a reloaded cell reconnects to the right endpoint.
export function setCellAgent(state: GridState, uid: number, agent: TerminalAgent, customAgent: string | null = null, account: string | null = null): GridState {
  // Claude is the ABSENT case, so switching back to it removes the key rather than setting it
  // to undefined — a persisted cell round-trips through JSON, where only the former survives.
  //
  // `customAgent` is REPLACED, not merely dropped, and the caller has to say which: a custom pick
  // reports `agent: "claude"` with its wrapper, and a plain claude launch reports the same agent
  // with none. Clearing on the agent alone cannot tell those apart, and cleared the wrapper on the
  // very launch that was using it — the live terminal kept it only until the next remount, then
  // reconnected as the built-in (codex + CodeRabbit, #1890).
  // `account` is replaced the same way, for the same reason: a launch on the default login reports
  // null, and keeping the previous value would label the new session with somebody else's login.
  const applied = ({ agent: _previous, customAgent: _wrapper, account: _login, ...rest }: Cell): Cell => ({
    ...rest,
    ...(agent === "claude" ? {} : { agent }),
    ...(customAgent === null ? {} : { customAgent }),
    ...(account === null ? {} : { account }),
  });
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? applied(c) : c)) };
}

// Set a cell aside, or bring it back. Unparking REMOVES the key rather than setting it to false —
// the same round-trip rule as `setCellAgent` above, and what keeps "not parked" one value on disk
// instead of two.
export function setCellParked(state: GridState, uid: number, parked: boolean): GridState {
  const applied = ({ parked: _previous, ...rest }: Cell): Cell => (parked ? { ...rest, parked: true } : rest);
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? applied(c) : c)) };
}

// A cell's launcher ran a script.json command: attach it, turning the launch cell
// into a command terminal. Ephemeral — command cells aren't persisted.
// The command came from THIS machine's launch form, so it runs here even in a cell that was remote.
export function runCommand(state: GridState, uid: number, command: Cell["command"]): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...withoutRemoteHost(c), command } : c)) };
}

const withoutRemoteHost = ({ remoteHost: _dropped, ...rest }: Cell): Cell => rest;

// A cell launched a configured program (shell/codex/…): attach the launcher and its
// directory, turning the launch cell into a persistent launcher terminal. Its session
// id arrives later from the server (setSession), so it persists and reconnects.
export function launchInCell(state: GridState, uid: number, launcher: CellLauncher, cwd: string | null): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, launcher, cwd } : c)) };
}

// Insert a brand-new cell immediately AFTER the cell that triggered it, so the header
// "new terminal" button and the Run button open next to the current cell rather than at
// the end. Falls back to appending when `afterUid` is gone. Jumps to the new cell's page —
// its MANUAL page, which is what the user sees only in manual mode; see revealCell.
export function insertCellAfter(state: GridState, afterUid: number, cell: Omit<Cell, "uid">): GridState {
  if (runningCount(state.cells) >= MAX_TERMINALS) return state;
  const idx = state.cells.findIndex((c) => c.uid === afterUid);
  const at = idx >= 0 ? idx + 1 : state.cells.length;
  const uid = state.nextUid;
  const cells = [...state.cells.slice(0, at), { ...cell, uid }, ...state.cells.slice(at)];
  const expanded = zoomedUid(state) !== null ? uid : state.expanded;
  return { ...state, cells, nextUid: state.nextUid + 1, page: Math.floor(at / PAGE_SIZE), expanded };
}

// Page the grid at whatever page actually SHOWS `uid`, given the display order.
//
// "auto" and "priority" order the whole list before paging (visibleOrdered), so a cell's manual
// index and the page it appears on are different questions — and insertCellAfter can only answer
// the first, since ordering needs live status and per-directory priority that a pure transform
// here is not given. On a grid of more than one page that gap leaves the new cell on a page the
// grid is not showing, and an unrendered cell never MOUNTS: its launcher, its command, or the
// agent an `autoStart` cell was opened for is then never started at all (Codex on #1557).
//
// `order` is the uid order the grid renders — orderCells over the state this is called with.
export function revealCell(state: GridState, uid: number, order: readonly number[]): GridState {
  return { ...state, page: pageHolding(order, uid, state.page) };
}

// Go to one terminal, as `next-attention` goes to its pick (#2446): enlarged, it becomes the
// enlarged one; otherwise its page comes on screen and the grid stays a grid. A uid no cell holds
// (a palette row gone stale) changes nothing: `expanded` naming a missing cell reads as un-zoomed.
export function jumpTo(state: GridState, uid: number, order: readonly number[]): GridState {
  if (!state.cells.some((c) => c.uid === uid)) return state;
  return zoomedUid(state) !== null ? { ...state, expanded: uid } : revealCell(state, uid, order);
}

// The Run button opened a script in a spare cell next to the cell that triggered it.
// On the host of the cell it was run from: a remote cell's Run menu and header buttons are the remote's.
export function runScriptInNewCell(state: GridState, afterUid: number, command: NonNullable<Cell["command"]>): GridState {
  const remoteHost = state.cells.find((c) => c.uid === afterUid)?.remoteHost;
  return insertCellAfter(state, afterUid, { session: null, cwd: null, command, ...(remoteHost ? { remoteHost } : {}) });
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

// Walk the keyboard focus one step along the on-screen `order` (dir -1 = previous, +1 = next),
// bringing the page that holds the target on screen. The un-zoomed counterpart of `moveZoom`
// (#2106): there the enlargement moves, here the cursor does.
//
// The caller focuses `moveFocusUid`'s answer. Moving the page without moving the cursor would
// leave the selection on a page nobody is looking at.
export function moveFocus(state: GridState, order: readonly number[], fromUid: number | null, dir: -1 | 1): GridState {
  const uid = moveFocusUid(state, order, fromUid, dir);
  return uid === null ? state : revealCell(state, uid, order);
}

/** The uid the keyboard focus moves to, or null when there is nowhere to go. */
export function moveFocusUid(state: GridState, order: readonly number[], fromUid: number | null, dir: -1 | 1): number | null {
  // Refused while zoomed, holding INVARIANT 3 where the arithmetic is rather than at the caller:
  // `page` is not maintained while a cell is enlarged, so moving it here would decide it at a
  // second moment. gridShortcutFor declines the key in that state too.
  if (zoomedUid(state) !== null) return null;
  // Empty launch cells are not terminals, so they are never somewhere to send anyone — the reason
  // nextCandidate skips them, plus one of its own: a launch form has no xterm, so focusing it is a
  // no-op and the key would read as dead.
  const occupied = new Set(state.cells.filter(isOccupied).map((c) => c.uid));
  const walk = order.filter((uid) => occupied.has(uid));
  const from = fromUid === null ? -1 : walk.indexOf(fromUid);
  // No origin — nothing has taken the cursor yet, or the cell that had it has closed. The first
  // terminal on the page being looked at IS the target then, not the origin: someone with no
  // position wants one, and stepping past it would skip the cell in front of them.
  if (from < 0) return pageSlice([...order], state.page).find((uid) => occupied.has(uid)) ?? null;
  // Stops at either end rather than wrapping, as moveZoom does — "I am at the last one" has to
  // feel different from "the key stopped working".
  return walk[from + dir] ?? null;
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
//  5. Entering the zoom is never refused for a cell that exists, and LEAVING it is never
//     refused either, whatever state the grid got into. It USED to need two running cells
//     (#374). Do not restore that: the zoomed row is the only place the Canvas / Tools / Files
//     panes exist, so the rule made them unreachable on a one-terminal grid, silently. The full
//     account, and the tests that hold it, are at toggleExpand below.
// ---------------------------------------------------------------------------------------

// Zoom `order[at]`. Shared by every action that ENTERS the zoom, so what entering means cannot
// drift between entry points.
function zoomAt(state: GridState, order: readonly number[], at: number): GridState {
  const uid = order[at];
  if (uid === undefined) return state;
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
const ATTENTION_ORDER: readonly AttentionStatus[] = ["blocked", "done", "idle"];

// Jump to the next terminal that wants the user, cycling from wherever the zoom is now — the
// "take me to whoever called" key. Also works un-zoomed, where it doubles as a way in.
//
// Wraps deliberately: this is a round of pending cells, not a list with ends, so pressing it
// repeatedly walks all of them and comes back rather than stopping on the last.
export function nextAttention(
  state: GridState,
  order: readonly number[],
  statusByUid: Record<number, AttentionStatus>,
  fromUid: number | null = null,
): GridState {
  const at = nextCandidate(state, order, statusByUid, zoomedUid(state) ?? fromUid);
  if (at === undefined) return state;
  // NEVER enlarges or collapses — that is toggleZoom's job alone. Zoomed, this moves which
  // terminal is enlarged; un-zoomed, it brings the candidate's page on screen and leaves the
  // grid a grid. A key that sometimes changed the whole layout would be unpredictable.
  return zoomedUid(state) !== null ? { ...state, expanded: order[at] ?? null } : { ...state, page: Math.floor(at / PAGE_SIZE) };
}

/** The uid of the terminal `nextAttention` would move to, or null. Exported so the caller can
 *  also put the cursor there — in a plain grid that focus IS the visible "you are here". */
export function nextAttentionUid(
  state: GridState,
  order: readonly number[],
  statusByUid: Record<number, AttentionStatus>,
  fromUid: number | null = null,
): number | null {
  const at = nextCandidate(state, order, statusByUid, zoomedUid(state) ?? fromUid);
  return at === undefined ? null : (order[at] ?? null);
}

// The index in `order` of the next terminal worth going to, starting after `from`, or undefined
// when there is none.
//
// `from` matters more than it looks: without it the rotation always begins at index 0, so every
// press picks the same first candidate and the key appears dead after the first one. Zoomed,
// that origin is the enlarged cell; un-zoomed it has to be the focused one, which only the
// caller knows.
function nextCandidate(state: GridState, order: readonly number[], statusByUid: Record<number, AttentionStatus>, fromUid: number | null): number | undefined {
  if (order.length === 0) return undefined;
  const from = order.indexOf(fromUid ?? -1); // -1 when nothing is current => search starts at 0
  const rotated = order.map((_, i) => (from + 1 + i) % order.length);
  // The empty launch cell is not a terminal, so it is never somewhere to send anyone — and it
  // would otherwise be picked constantly, since a cell with no reported status reads as `idle`
  // below and a launcher never reports one. countByStatus skips it for the same reason.
  const occupied = new Set(state.cells.filter(isOccupied).map((c) => c.uid));
  for (const status of ATTENTION_ORDER) {
    // Absent = idle, the convention AttentionStatus documents: a cell whose status has not been
    // reported yet must not fall out of the search entirely.
    const at = rotated.find((i) => {
      const uid = order[i];
      return uid !== undefined && occupied.has(uid) && (statusByUid[uid] ?? "idle") === status;
    });
    if (at !== undefined) return at;
  }
  return undefined;
}

// ENTERING THE ZOOM IS NOT GATED ON A SECOND CELL. Do not put that rule back (2026-08-03).
//
// It was here from #374, which read zooming as only "one cell big, the rest as a filmstrip": with
// nothing to switch to, the button swapped a working layout for an empty filmstrip and squeezed the
// terminal's status bar off the bottom of the viewport, for no gain. On that reading the refusal is
// right, and that is exactly why it is worth writing down why it is nevertheless gone — the issue
// still reads as sound, and re-deriving it from the issue alone lands straight back on the guard.
//
// What the reading missed: the zoomed row was ALSO the only place the right-hand panes existed
// (Canvas, Tools, Files — see TerminalGrid.vue's .zoom-row). Nothing sat beside a tiled cell then
// (a pane can now, #3027, but an agent's drawing still reveals itself through the zoom). So on
// a one-terminal grid the refusal did not merely decline a layout, it locked those panes away
// entirely: the unread-canvas chip did nothing when clicked, and an agent drawing to the Canvas had
// nowhere to be shown. That is how it was found — the owner ran the new auto-reveal (an agent's
// drawing enlarges its cell and opens the Canvas) on a grid with one terminal, and NOTHING
// happened. There is no error in that failure mode, on either side: the reveal asks for the zoom,
// the state politely declines, and the feature simply appears not to work.
//
// The cost #374 weighed is also smaller than it looked: the thing beside the enlarged cell is the
// roster/filmstrip, which is a mode the user toggles, and enlarging your one terminal turns out to
// be a thing to want on its own terms. Owner's call, after hitting it live.
//
// Pinned by "zooms the only occupied cell" / "ENTERS the zoom with one running cell" in
// gridTabs.spec.ts and "enlarges even when that terminal is the only one" in
// gridCanvasAutoExpand.spec.ts. A change that reinstates the guard fails all three.
//
// Collapsing is never refused either: whatever a state got into, ⤡ has to get out of it.
export function toggleExpand(state: GridState, uid: number, order: readonly number[] = []): GridState {
  if (state.expanded === uid) return { ...state, expanded: null, page: pageHolding(order, uid, state.page) };
  if (!state.cells.some((c) => c.uid === uid)) return state;
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
  const here = cells[i];
  const there = cells[i + dir];
  if (!here || !there) return state; // out of range — nothing to swap
  [cells[i], cells[i + dir]] = [there, here];
  return { ...state, cells };
}

// Lift `uid` out of a keyed list and put it back in front of `beforeUid` (null = at the end).
// Order only — no guard, no state: the roster's drag PREVIEW renders this over its rows while
// `moveCellBefore` applies it to the cells, so what the list shows mid-drag is by construction
// what the drop commits. A destination the list does not hold leaves the order alone.
export function reorderBefore<T extends { uid: number }>(items: readonly T[], uid: number, beforeUid: number | null): T[] {
  const rest = items.filter((i) => i.uid !== uid);
  if (rest.length === items.length) return [...items]; // nothing named `uid` to move
  const at = beforeUid === null ? rest.length : rest.findIndex((i) => i.uid === beforeUid);
  if (at < 0) return [...items];
  return [...rest.slice(0, at), ...items.filter((i) => i.uid === uid), ...rest.slice(at)];
}

// Whether `beforeUid` names a slot the dragged cell may OCCUPY (null = the end of the list): both
// cells known, not the cell itself, and never past a trailing launch cell — that one keeps the last
// slot, because "+ Terminal"/cancel act on it. Dragging the launcher ITSELF is allowed, which is
// what canMoveCell(launchUid, -1) already permits.
//
// The destination is a UID rather than an index because the caller counts rows in the array it
// RENDERS (`displayCells`) while this reduces the array the grid OWNS (`state.cells`). Those are
// the same list while zoomed in manual sort — the only state a drag exists in — but that is an
// invariant held in two files, and an index is the one payload that would silently mean something
// else if it ever stopped holding.
export function canDropCellBefore(cells: Cell[], uid: number, beforeUid: number | null): boolean {
  if (beforeUid === uid || !cells.some((c) => c.uid === uid)) return false;
  if (beforeUid !== null && !cells.some((c) => c.uid === beforeUid)) return false;
  const last = cells[cells.length - 1];
  return !(beforeUid === null && isLaunchCell(last) && last?.uid !== uid);
}

// Whether moveCellBefore would actually REORDER: a slot the cell may occupy, and not the one it is
// already in. The two are separate because hovering the slot a row started in is a legal thing to
// do mid-drag — the preview has to show the row back in place — it just commits nothing.
export function canMoveCellBefore(cells: Cell[], uid: number, beforeUid: number | null): boolean {
  if (!canDropCellBefore(cells, uid, beforeUid)) return false;
  const from = cells.findIndex((c) => c.uid === uid);
  const to = beforeUid === null ? cells.length : cells.findIndex((c) => c.uid === beforeUid);
  return to !== from + 1; // in front of your own successor is where you already are
}

// Manual reorder to an arbitrary position. A no-op wherever canMoveCellBefore says no, so a drag
// that ends where it started returns the same state object.
export function moveCellBefore(state: GridState, uid: number, beforeUid: number | null): GridState {
  if (!canMoveCellBefore(state.cells, uid, beforeUid)) return state;
  return { ...state, cells: reorderBefore(state.cells, uid, beforeUid) };
}

// The zoomed cell's uid, or null when nothing is zoomed (or `expanded` is stale —
// points at a cell no longer in the list).
export const zoomedUid = (state: GridState): number | null =>
  state.expanded !== null && state.cells.some((c) => c.uid === state.expanded) ? state.expanded : null;

// Attention-first rank for the "auto" order: blocked (needs input now) first, then
// done (finished, review it), then idle, then working, with empty launch cells last.
// Lower sorts earlier.
const RANK: Record<AttentionStatus, number> = { blocked: 0, done: 1, idle: 2, working: 3 };
const LAUNCH_RANK = 4;
const cellRank = (c: Cell, statusByUid: Record<number, AttentionStatus>): number => (isLaunchCell(c) ? LAUNCH_RANK : RANK[statusByUid[c.uid] ?? "idle"]);

const cellPriority = (c: Cell, priorityByCwd: Record<string, number>): number => dirPriority(c.cwd, priorityByCwd);

// Display order. "manual": the hand-arranged list as-is. "auto": a STABLE sort by
// attention rank — equal-rank cells keep their manual order, so a status change
// only floats that one cell to its bucket and doesn't reshuffle the rest.
// "priority": the same stable shape, keyed on each directory's declared rank instead.
//
// Empty launch cells are held last by their own comparison level rather than by their key:
// in "priority" every unset directory already keys to Infinity, so a key alone could not put
// a launch cell after them. ("auto" reaches the same place via LAUNCH_RANK — this level is
// what makes the two modes agree instead of coinciding.)
export function orderCells(cells: Cell[], statusByUid: Record<number, AttentionStatus>, mode: SortMode, priorityByCwd: Record<string, number> = {}): Cell[] {
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
export const visibleOrdered = (state: GridState, statusByUid: Record<number, AttentionStatus>, priorityByCwd: Record<string, number> = {}): Cell[] => {
  const ordered = orderCells(state.cells, statusByUid, state.sortMode, priorityByCwd);
  return zoomedUid(state) !== null ? ordered : pageSlice(ordered, state.page);
};

export type StatusCounts = Record<AttentionStatus, number>;

// Tally occupied cells (a running session or command) by status — empty launchers are
// skipped. Powers the toolbar's at-a-glance "N need you" summary across ALL pages.
export function countByStatus(cells: Cell[], statusByUid: Record<number, AttentionStatus>): StatusCounts {
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
  if (!isRecord(c)) return false;
  const sessionOk = c.session === null || (typeof c.session === "string" && isUuid(c.session));
  return sessionOk && (c.cwd === null || typeof c.cwd === "string");
};

export function parseGridState(raw: string | null): GridState | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!isRecord(parsed) || !isUnknownArray(parsed.cells)) return null;
    const { expanded: storedExpanded, page: storedPage } = parsed;
    // Keep only running cells (the trailing launch cell is ephemeral) and renumber
    // uids from position. Persisted uids are untrusted: duplicates would collide
    // v-for keys, and a near-MAX_SAFE_INTEGER value would overflow the nextUid
    // counter. uid is internal identity only, so a clean 0..n-1 space (nextUid =
    // count) is always safe and in range.
    const running = parsed.cells
      .filter(isCell)
      .filter((c) => c.session !== null)
      .slice(0, MAX_TERMINALS);
    // Every field a cell keeps across a reload is named HERE — a persisted key this literal does
    // not rebuild is dropped silently, with nothing to typecheck against.
    const cells: Cell[] = running.map((c, i) => {
      // Spread, not assigned: `agent` is absent for a Claude cell, and under
      // exactOptionalPropertyTypes a key holding undefined is not the same as no key.
      const agent = storedCellAgent(asTerminalAgent(c.agent));
      return {
        uid: i,
        session: c.session,
        cwd: c.cwd,
        launcher: asLauncher(c.launcher),
        ...(agent === undefined ? {} : { agent }),
        ...(isCustomAgentId(c.customAgent) ? { customAgent: c.customAgent } : {}),
        ...(isAccountId(c.account) ? { account: c.account } : {}),
        ...(isRemoteHostId(c.remoteHost) ? { remoteHost: c.remoteHost } : {}),
        ...(c.parked === true ? { parked: true as const } : {}),
      };
    });
    const expandedIdx = running.findIndex((c) => c.uid === storedExpanded);
    const expanded = typeof storedExpanded === "number" && expandedIdx >= 0 ? expandedIdx : null;
    const page = typeof storedPage === "number" && Number.isSafeInteger(storedPage) && storedPage >= 0 ? storedPage : 0;
    return clampPage(ensureEntry({ cells, expanded, page, nextUid: cells.length, sortMode: asSortMode(parsed.sortMode) }));
  } catch {
    return null;
  }
}

// Migrate the legacy single-grid shape ({ sessions, cwds, expanded:position }).
export function migrateLegacy(raw: string | null): GridState | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!isRecord(parsed) || !isUnknownArray(parsed.sessions)) return null;
    const cwds = isUnknownArray(parsed.cwds) ? parsed.cwds : [];
    const cells: Cell[] = [];
    parsed.sessions.forEach((s, i) => {
      if (isUuid(s)) cells.push({ uid: cells.length, session: s, cwd: typeof cwds[i] === "string" ? cwds[i] : null });
    });
    const { expanded: storedExpanded } = parsed;
    const expanded = typeof storedExpanded === "number" && storedExpanded >= 0 && storedExpanded < cells.length ? (cells[storedExpanded]?.uid ?? null) : null;
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
  bySession: ReadonlyMap<string, AttentionStatus>,
  byUid: Readonly<Record<number, AttentionStatus>>,
): Record<number, AttentionStatus> {
  const out: Record<number, AttentionStatus> = {};
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
type GridStatusPartKey = "tips.toolbar.needInput" | "tips.toolbar.doneReview" | "tips.toolbar.working" | "tips.toolbar.idle";

export interface GridStatusSummary {
  show: boolean;
  /** The tooltip's parts in reading order, as messages: the words are the UI language's. */
  parts: { key: GridStatusPartKey; count: number }[];
}

/** The tooltip itself: each part in the UI's language, joined the way the strip always read. */
export const gridStatusTitle = (summary: GridStatusSummary, translate: Translate): string =>
  summary.parts.map((part) => translate(part.key, { count: part.count })).join(" · ");

export function gridStatusSummary(counts: StatusCounts | null | undefined): GridStatusSummary {
  if (!counts) return { show: false, parts: [] };
  const parts: GridStatusSummary["parts"] = [];
  if (counts.blocked) parts.push({ key: "tips.toolbar.needInput", count: counts.blocked });
  if (counts.done) parts.push({ key: "tips.toolbar.doneReview", count: counts.done });
  if (counts.working) parts.push({ key: "tips.toolbar.working", count: counts.working });
  if (counts.idle) parts.push({ key: "tips.toolbar.idle", count: counts.idle });
  return { show: counts.blocked + counts.done + counts.working > 0, parts };
}
