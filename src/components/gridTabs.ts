// The grid is ONE flat, ordered list of terminal cells, split into pages of 9
// (the tabs). Closing a cell reflows the whole list so later pages pack forward
// into the gap (terminals flow across page boundaries); "+ Terminal" appends a
// launch cell, overflowing into a new page when the last one is full. GridView
// owns a single GridState ref and drives it through these pure transforms;
// TerminalGrid just renders the active page's slice.

export interface Cell {
  uid: number;
  session: string | null;
  cwd: string | null;
}
export interface GridState {
  cells: Cell[];
  expanded: number | null; // uid of the zoomed cell, or null
  page: number;
  nextUid: number;
}

export const PAGE_SIZE = 9;
export const MAX_TERMINALS = 81; // 9 pages
export const STATE_KEY = "grid_v2";
export const LEGACY_KEY = "grid_state_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pageCount = (cellCount: number) => Math.max(1, Math.ceil(cellCount / PAGE_SIZE));
export const pageSlice = <T>(cells: T[], page: number) => cells.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
export const runningCount = (cells: Cell[]) => cells.filter((c) => c.session !== null).length;

const clampPage = (s: GridState): GridState => ({ ...s, page: Math.min(Math.max(0, s.page), pageCount(s.cells.length) - 1) });

// Always keep at least one cell — the entry launch cell on an otherwise empty grid.
const ensureEntry = (s: GridState): GridState =>
  s.cells.length > 0 ? s : { ...s, cells: [{ uid: s.nextUid, session: null, cwd: null }], nextUid: s.nextUid + 1 };

// "+ Terminal": append a launch cell (overflowing into a new page when full), or
// cancel an already-open launch cell. The sole entry cell is never removed.
export function addCell(state: GridState): GridState {
  const last = state.cells[state.cells.length - 1];
  if (last && last.session === null) {
    if (state.cells.length <= 1) return state; // the entry cell — nothing to add or cancel
    return clampPage({ ...state, cells: state.cells.slice(0, -1) }); // cancel the open launch cell
  }
  if (runningCount(state.cells) >= MAX_TERMINALS) return state;
  const cells = [...state.cells, { uid: state.nextUid, session: null, cwd: null }];
  return { ...state, cells, nextUid: state.nextUid + 1, page: pageCount(cells.length) - 1 };
}

export function setSession(state: GridState, uid: number, id: string | null): GridState {
  const cells = state.cells.map((c) => (c.uid === uid ? { ...c, session: id } : c));
  const expanded = id === null && state.expanded === uid ? null : state.expanded;
  return { ...state, cells, expanded };
}

export function setCwd(state: GridState, uid: number, cwd: string): GridState {
  return { ...state, cells: state.cells.map((c) => (c.uid === uid ? { ...c, cwd } : c)) };
}

// Close a cell: drop it and reflow the list (later cells pack forward across
// pages), un-zoom if it was zoomed, keep an entry cell, and clamp the page.
export function closeCell(state: GridState, uid: number): GridState {
  const cells = state.cells.filter((c) => c.uid !== uid);
  const expanded = state.expanded === uid ? null : state.expanded;
  return ensureEntry(clampPage({ ...state, cells, expanded }));
}

export function toggleExpand(state: GridState, uid: number): GridState {
  return { ...state, expanded: state.expanded === uid ? null : uid };
}

// Switch page: drop an abandoned trailing launch cell first and clear the zoom
// (zoom is scoped to a page).
export function switchPage(state: GridState, page: number): GridState {
  const last = state.cells[state.cells.length - 1];
  const cells = last && last.session === null && state.cells.length > 1 ? state.cells.slice(0, -1) : state.cells;
  return clampPage({ ...state, cells, expanded: null, page });
}

const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
// uid must be a non-negative safe integer: localStorage is untrusted, and a bad or
// duplicate uid would collide v-for keys and make uid-targeted mutators hit more
// than one cell.
const isCell = (c: unknown): c is Cell => {
  const o = c as Cell | null;
  return !!o && Number.isSafeInteger(o.uid) && o.uid >= 0 && (o.session === null || isUuid(o.session)) && (o.cwd === null || typeof o.cwd === "string");
};

const dedupeByUid = (cells: Cell[]): Cell[] => {
  const seen = new Set<number>();
  return cells.filter((c) => {
    if (seen.has(c.uid)) return false;
    seen.add(c.uid);
    return true;
  });
};

export function parseGridState(raw: string | null): GridState | null {
  try {
    const parsed = JSON.parse(raw ?? "");
    if (!Array.isArray(parsed?.cells)) return null;
    const cells: Cell[] = dedupeByUid(parsed.cells.filter(isCell)).slice(0, MAX_TERMINALS);
    const maxUid = cells.reduce((m: number, c: Cell) => Math.max(m, c.uid), -1);
    const nextUid = Number.isSafeInteger(parsed.nextUid) && parsed.nextUid > maxUid ? parsed.nextUid : maxUid + 1;
    const expanded = typeof parsed.expanded === "number" && cells.some((c) => c.uid === parsed.expanded && c.session !== null) ? parsed.expanded : null;
    return clampPage(ensureEntry({ cells, expanded, page: typeof parsed.page === "number" ? parsed.page : 0, nextUid }));
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
    return clampPage(ensureEntry({ cells, expanded, page: 0, nextUid: cells.length }));
  } catch {
    return null;
  }
}

export function initialState(curRaw: string | null, legacyRaw: string | null): { state: GridState; migrated: boolean } {
  const cur = parseGridState(curRaw);
  if (cur) return { state: cur, migrated: false };
  const migrated = migrateLegacy(legacyRaw);
  if (migrated) return { state: migrated, migrated: true };
  return { state: ensureEntry({ cells: [], expanded: null, page: 0, nextUid: 0 }), migrated: false };
}
