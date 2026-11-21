// Which repos the board and the PR / issue lists read beyond the configured ones (#3372, #3377), pure.
import { repoIdentity } from "../../common/repoEntry.js";

/** The repos a live cell is in that are not configured, each once and by the name first seen, sorted. */
export const unconfiguredRepos = (configured: readonly string[], cellRepos: readonly string[]): string[] => {
  const known = new Set(configured.map(repoIdentity));
  const byIdentity = new Map<string, string>();
  cellRepos.forEach((repo) => {
    const identity = repoIdentity(repo);
    if (!known.has(identity) && !byIdentity.has(identity)) byIdentity.set(identity, repo);
  });
  return [...byIdentity.values()].sort((a, b) => a.localeCompare(b));
};

const orNone = async (find: () => Promise<string[]>): Promise<string[]> => {
  try {
    return await find();
  } catch {
    return [];
  }
};

/** The configured repos' rows, then the unregistered ones' marked as such. An unregistered repo is one
 *  the user never asked for, so when it cannot be read — or cannot even be found — it is left out
 *  rather than costing the configured rows. */
export const withUnregisteredLists = async <Row extends { error?: string; unregistered?: boolean }>(
  configured: readonly string[],
  findUnregistered: () => Promise<string[]>,
  list: (repos: string[]) => Promise<Row[]>,
): Promise<Row[]> => {
  const listUnregistered = async (): Promise<Row[]> => list(await orNone(findUnregistered));
  const [configuredRows, unregisteredRows] = await Promise.all([list([...configured]), listUnregistered()]);
  return [...configuredRows, ...unregisteredRows.flatMap((row): Row[] => (row.error === undefined ? [{ ...row, unregistered: true }] : []))];
};
