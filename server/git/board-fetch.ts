// The GitHub board's inputs (#3172): per configured repo (and per GitHub repo a live cell is in, #3372), its open and recently merged PRs and its
// open issues through `gh`, and the live cells whose directory is a checkout of it. The decisions
// are in board.ts; this file only gathers.
import type { BoardCell, BoardDetailResponse, BoardIssue, RepoBoard } from "../../common/githubBoard.js";
import { runGh } from "./gh.js";
import { buildRepoBoard, mainlineCells, parseBoardPr, type BoardPrRow, type CellOnBranch } from "./board.js";
import { ISSUE_DETAIL_FIELDS, PR_DETAIL_FIELDS, parseIssueDetail, parsePrDetail } from "./board-detail.js";
import { currentBranch } from "./git-status.js";
import { isSupported, repoForDir, repoSupport } from "./forge-support.js";
import { projectPath } from "./forge-host.js";
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import { isUnknownArray } from "../../common/isUnknownArray.js";
import { repoIdentity } from "../../common/repoEntry.js";
import { unconfiguredRepos } from "./board-repos.js";

export const BOARD_OPEN_LIMIT = 50;
export const BOARD_MERGED_LIMIT = 10;

const PR_FIELDS = "number,title,url,isDraft,reviewDecision,statusCheckRollup,headRefName,headRefOid,closingIssuesReferences,reviews";

// Comments carry the codex verdicts (#3196) and are most of the payload on a PR that went through a
// review loop, so they are read only where a verdict still decides something: on an open PR.
const prFields = (state: "open" | "merged"): string => (state === "open" ? `${PR_FIELDS},comments` : PR_FIELDS);

/** A live cell before its repo and branch are known. */
export type LiveCell = BoardCell;

const ERROR_TEXT_LIMIT = 300;

const ghValue = async (args: string[]): Promise<unknown> => {
  const res = await runGh(args);
  if (!res.ok) throw new Error((res.stderr.trim() || `gh ${args.slice(0, 2).join(" ")} failed`).slice(0, ERROR_TEXT_LIMIT));
  const parsed: unknown = JSON.parse(res.stdout);
  return parsed;
};

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const ghJson = async (args: string[]): Promise<unknown[]> => {
  const parsed = await ghValue(args);
  return isUnknownArray(parsed) ? parsed : [];
};

const listPrs = async (repo: string, state: "open" | "merged", limit: number): Promise<BoardPrRow[]> =>
  (await ghJson(["pr", "list", "--repo", repo, "--state", state, "--limit", String(limit), "--json", prFields(state)])).flatMap(
    (raw) => parseBoardPr(raw, repo) ?? [],
  );

const listIssues = async (repo: string): Promise<BoardIssue[]> =>
  (await ghJson(["issue", "list", "--repo", repo, "--state", "open", "--limit", String(BOARD_OPEN_LIMIT), "--json", "number,title,url"])).flatMap(
    (raw): BoardIssue[] =>
      isRecord(raw) && typeof raw.number === "number" ? [{ number: raw.number, title: readString(raw.title), url: readString(raw.url) }] : [],
  );

// Null when it cannot be read: the board then shows a cell on any branch rather than guessing a name.
const defaultBranchOf = async (repo: string): Promise<string | null> => {
  const res = await runGh(["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  return res.ok && res.stdout.trim() ? res.stdout.trim() : null;
};

interface PlacedCells {
  cellsByRepo: Map<string, CellOnBranch[]>;
  /** Every repo a cell is in that is on GitHub, by `owner/repo`. */
  githubRepos: string[];
}

interface CellPlace {
  repo: string;
  /** Null when HEAD is detached. */
  branch: string | null;
  github: boolean;
}

const NO_HEAD = { branch: null, detached: false };

// A detached HEAD still places the cell, on no branch; a directory git cannot read a HEAD in does not.
const placeOf = async (cwd: string): Promise<CellPlace | null> => {
  const [dirRepo, head] = await Promise.all([repoForDir(cwd).catch(() => null), currentBranch(cwd).catch(() => NO_HEAD)]);
  if (!dirRepo?.repo || (!head.branch && !head.detached)) return null;
  return { repo: dirRepo.repo, branch: head.branch, github: dirRepo.forge.kind === "github" };
};

// Which repo and branch each cell's directory is on, resolved once per directory.
async function placeCells(cells: readonly LiveCell[]): Promise<PlacedCells> {
  const byCwd = new Map<string, CellPlace | null>();
  await Promise.all([...new Set(cells.map((cell) => cell.cwd))].map(async (cwd) => byCwd.set(cwd, await placeOf(cwd))));
  const cellsByRepo = new Map<string, CellOnBranch[]>();
  cells.forEach((cell) => {
    const place = byCwd.get(cell.cwd);
    if (place) cellsByRepo.set(repoIdentity(place.repo), [...(cellsByRepo.get(repoIdentity(place.repo)) ?? []), { ...cell, branch: place.branch }]);
  });
  const githubRepos = [...byCwd.values()].flatMap((place) => (place?.github ? [place.repo] : []));
  return { cellsByRepo, githubRepos };
}

/** The GitHub repos a live cell is in, by `owner/repo`. */
export const liveCellRepos = async (liveCells: readonly LiveCell[]): Promise<string[]> => (await placeCells(liveCells)).githubRepos;

async function repoBoard(repo: string, cells: readonly CellOnBranch[]): Promise<RepoBoard> {
  try {
    const [openPrs, mergedPrs, openIssues, defaultBranch] = await Promise.all([
      listPrs(repo, "open", BOARD_OPEN_LIMIT),
      listPrs(repo, "merged", BOARD_MERGED_LIMIT),
      listIssues(repo),
      defaultBranchOf(repo),
    ]);
    const cards = buildRepoBoard({ repo, defaultBranch, openPrs, mergedPrs, openIssues, cells });
    const mainline = mainlineCells(cells, defaultBranch);
    return mainline.length > 0 ? { repo, cards, mainlineCells: mainline } : { repo, cards };
  } catch (err) {
    return { repo, error: errorText(err) };
  }
}

// The board names a repo as its `owner/repo`; a request may only ask about one that is configured.
const configuredProject = (repo: string, configured: readonly string[]): string | null => {
  const entry = configured.find((candidate) => repoIdentity(candidate) === repoIdentity(repo));
  const support = entry === undefined ? null : repoSupport(entry);
  if (!support || !isSupported(support) || support.forge.kind !== "github") return null;
  return projectPath(support.forge);
};

/** The detail panel's data for one card: the issue and/or the PR, each read on its own so one
 *  failing still shows the other. Null when `repo` is not a configured GitHub repo. */
export async function boardDetail(repo: string, configured: readonly string[], issue: number | null, pr: number | null): Promise<BoardDetailResponse | null> {
  const project = configuredProject(repo, configured);
  if (!project) return null;
  const errors: string[] = [];
  const read = async <T>(number: number | null, kind: "issue" | "pr", fields: string, parse: (raw: unknown) => T | null): Promise<T | null> => {
    if (number === null) return null;
    try {
      return parse(await ghValue([kind, "view", String(number), "--repo", project, "--json", fields]));
    } catch (err) {
      errors.push(`${kind} #${number}: ${errorText(err)}`);
      return null;
    }
  };
  const [issueDetail, prDetail] = await Promise.all([
    read(issue, "issue", ISSUE_DETAIL_FIELDS, parseIssueDetail),
    read(pr, "pr", PR_DETAIL_FIELDS, parsePrDetail),
  ]);
  return { issue: issueDetail, pr: prDetail, errors };
}

const configuredBoard = async (repo: string, cellsByRepo: Map<string, CellOnBranch[]>): Promise<RepoBoard> => {
  const support = repoSupport(repo);
  if (!isSupported(support)) return { repo, error: support.error };
  const project = support.forge.kind === "github" ? projectPath(support.forge) : null;
  if (!project) return { repo, error: "only GitHub repositories are shown on the board" };
  return repoBoard(project, cellsByRepo.get(repoIdentity(repo)) ?? []);
};

// One the user never asked for: when it cannot be read it is left out rather than shown as an error.
const unregisteredBoards = async (repos: readonly string[], cellsByRepo: Map<string, CellOnBranch[]>): Promise<RepoBoard[]> => {
  const boards = await Promise.all(repos.map((repo) => repoBoard(repo, cellsByRepo.get(repoIdentity(repo)) ?? [])));
  return boards.flatMap((board) => (board.error === undefined ? [{ ...board, unregistered: true }] : []));
};

/** One board per configured repo, then one per unconfigured GitHub repo a live cell is in. A configured
 *  repo that is not on GitHub, or that `gh` cannot read, carries an error. */
export async function boardAcrossRepos(repos: readonly string[], liveCells: readonly LiveCell[]): Promise<RepoBoard[]> {
  const { cellsByRepo, githubRepos } = await placeCells(liveCells);
  const [configured, unregistered] = await Promise.all([
    Promise.all(repos.map((repo) => configuredBoard(repo, cellsByRepo))),
    unregisteredBoards(unconfiguredRepos(repos, githubRepos), cellsByRepo),
  ]);
  return [...configured, ...unregistered];
}
