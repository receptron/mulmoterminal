// The board narrowed to the work a terminal is open on (#3359), pure.
import { BOARD_COLUMNS, type BoardColumn, type RepoBoard } from "../../common/githubBoard";

const withCells = (repo: RepoBoard): RepoBoard =>
  repo.error !== undefined ? repo : { ...repo, cards: (repo.cards ?? []).filter((card) => card.cells.length > 0) };

const worthShowing = (repo: RepoBoard): boolean => repo.error !== undefined || (repo.cards ?? []).length > 0 || (repo.mainlineCells ?? []).length > 0;

/** Only the cards carrying a cell. A repo left with none goes too, unless it has an error to show or a
 *  cell on its default branch. */
export const openWorkOnly = (repos: readonly RepoBoard[]): RepoBoard[] => repos.map(withCells).filter(worthShowing);

/** The configured repos only: one read because a terminal is open in it is not part of "everything". */
export const registeredOnly = (repos: readonly RepoBoard[]): RepoBoard[] => repos.filter((repo) => repo.unregistered !== true);

/** Every column, or with the switch on only the columns that hold a card. */
export const visibleColumns = (repo: RepoBoard, openOnly: boolean): readonly BoardColumn[] =>
  openOnly ? BOARD_COLUMNS.filter((column) => (repo.cards ?? []).some((card) => card.column === column)) : BOARD_COLUMNS;
