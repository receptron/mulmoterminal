// The board's live half (#3182), pure: the cards as the `sessions` channel says their cells are now,
// and which cells have just finished a turn — the moment a push or a new PR is likely, so the board
// is worth reading again.
import type { BoardCard, BoardCell, RepoBoard } from "../../common/githubBoard";
import type { CellActivity } from "../composables/sessionActivity";

const repoCells = (repo: RepoBoard): BoardCell[] => [...(repo.cards ?? []).flatMap((card) => card.cells), ...(repo.mainlineCells ?? [])];

/** Every session id the board shows a cell for, on a card or on the default branch. */
export const boardSessionIds = (repos: readonly RepoBoard[]): string[] => [...new Set(repos.flatMap((repo) => repoCells(repo).map((cell) => cell.session)))];

// Every cell list in a repo — each card's and the default branch's — passed through `change`.
const withEachCellList = (repo: RepoBoard, change: <T extends BoardCell>(cells: T[]) => T[]): RepoBoard => {
  const next: RepoBoard = repo.cards ? { ...repo, cards: repo.cards.map((card: BoardCard) => ({ ...card, cells: change(card.cells) })) } : { ...repo };
  if (repo.mainlineCells) next.mainlineCells = change(repo.mainlineCells);
  return next;
};

const liveCell = <T extends BoardCell>(cell: T, activity: ReadonlyMap<string, CellActivity>): T => {
  const live = activity.get(cell.session);
  return live ? { ...cell, working: live.working, waiting: live.waiting } : cell;
};

/** The board with each cell's working / waiting taken from the live feed where it has a word. */
export const withLiveCells = (repos: readonly RepoBoard[], activity: ReadonlyMap<string, CellActivity>): RepoBoard[] =>
  repos.map((repo) => withEachCellList(repo, (cells) => cells.map((cell) => liveCell(cell, activity))));

/** A card some cell of which is waiting for the user. */
export const cardWaiting = (card: BoardCard): boolean => card.cells.some((cell) => cell.waiting);

/** Sessions that were working before and are not now. A session absent from `now` has closed, which
 *  ends its turn too. */
export const finishedTurns = (before: ReadonlyMap<string, boolean>, now: ReadonlyMap<string, boolean>): string[] =>
  [...before.entries()].filter(([session, working]) => working && now.get(session) !== true).map(([session]) => session);

/** The board without the cells whose session has closed since it was read (#3363). A cell only
 *  waiting to be reaped is not here: it is still alive and comes back on a reload. */
export const withoutClosedCells = (repos: readonly RepoBoard[], closed: ReadonlyMap<string, number>): RepoBoard[] =>
  closed.size === 0 ? [...repos] : repos.map((repo) => withEachCellList(repo, (cells) => cells.filter((cell) => !closed.has(cell.session))));

/** The closes a read already reflects, dropped. Each close is stamped with the event count at the
 *  moment it arrived; a read that STARTED at count `readStartedAt` has seen every close stamped
 *  before it, while a later close must outlive that read, or the read puts its cell back. */
export const closesAfter = (closed: ReadonlyMap<string, number>, readStartedAt: number): Map<string, number> =>
  new Map([...closed.entries()].filter(([, stamp]) => stamp >= readStartedAt));
