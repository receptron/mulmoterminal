// The cells closed most recently, so one closed by accident can be found and reopened (#2800).
// Pure: the list is passed in and handed back, and the clock is an argument.
import { isRecord } from "../../common/isRecord";
import { asTerminalAgent, isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { cellForPanelResume } from "../components/launchCell";
import { isRemoteHost } from "../components/remoteCell";
import { isShellLauncher, shellCell, type Cell } from "../components/gridTabs";
import type { SessionMetaView } from "../components/rosterPhase";

/** An agent's conversation, resumed by its session id; or a shell, which comes back fresh. */
export type ClosedCell =
  | { kind: "session"; session: string; cwd: string | null; agent: TerminalAgent; account: string | null; title: string; closedAt: number }
  | { kind: "shell"; cwd: string | null; title: string; closedAt: number };

export const RECENTLY_CLOSED_MAX = 20;

const basename = (path: string | null): string => (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

/** What the roster would call the session: the user's memo first, then their `/rename` name, then the agent's title, then the prompt. */
export const closedTitle = (meta: Pick<SessionMetaView, "memo" | "customTitle" | "aiTitle" | "agentTitle" | "lastPrompt"> | undefined): string | null =>
  meta ? (meta.memo ?? meta.customTitle ?? meta.aiTitle ?? meta.agentTitle ?? meta.lastPrompt) : null;

/** What reopening `cell` needs, or null for a cell there is nothing to reopen of. A command cell is
 *  ephemeral, and a configured launcher is addressed by its position in a list that may have moved. */
export function closedCellOf(cell: Cell, title: string | null, now: number): ClosedCell | null {
  // A remote cell reopened from here would come back as a LOCAL session under the remote's id.
  if (cell.command || isRemoteHost(cell.remoteHost)) return null;
  const shown = title?.trim() || basename(cell.cwd);
  if (cell.launcher) return isShellLauncher(cell.launcher) ? { kind: "shell", cwd: cell.cwd, title: shown, closedAt: now } : null;
  if (cell.session === null) return null;
  const account = cell.account ?? null;
  return { kind: "session", session: cell.session, cwd: cell.cwd, agent: asTerminalAgent(cell.agent), account, title: shown, closedAt: now };
}

/** Tells two entries apart: the same conversation under two logins is two entries (#2215). */
export const closedCellId = (entry: ClosedCell): string =>
  entry.kind === "session" ? `session:${entry.account ?? ""}:${entry.session}` : `shell:${entry.cwd ?? ""}`;

/** The list with `entry` first; closing the same thing again moves it up rather than listing it twice. */
export function rememberClosed(list: readonly ClosedCell[], entry: ClosedCell): ClosedCell[] {
  const id = closedCellId(entry);
  return [entry, ...list.filter((other) => closedCellId(other) !== id)].slice(0, RECENTLY_CLOSED_MAX);
}

export const forgetClosed = (list: readonly ClosedCell[], entry: ClosedCell): ClosedCell[] => {
  const id = closedCellId(entry);
  return list.filter((other) => closedCellId(other) !== id);
};

/** The entries worth offering: a conversation the grid has open again is not closed any more. */
export const reopenableClosed = (list: readonly ClosedCell[], openSessionIds: readonly string[]): ClosedCell[] =>
  list.filter((entry) => entry.kind === "shell" || !openSessionIds.includes(entry.session));

export const cellForClosed = (entry: ClosedCell): Omit<Cell, "uid"> =>
  entry.kind === "session" ? cellForPanelResume({ id: entry.session, cwd: entry.cwd, agent: entry.agent, account: entry.account }) : shellCell(entry.cwd);

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

function readEntry(value: unknown): ClosedCell | null {
  if (!isRecord(value) || !isNullableString(value.cwd) || typeof value.title !== "string") return null;
  if (typeof value.closedAt !== "number" || !Number.isFinite(value.closedAt)) return null;
  const { cwd, title, closedAt } = value;
  if (value.kind === "shell") return { kind: "shell", cwd, title, closedAt };
  if (value.kind !== "session" || typeof value.session !== "string" || value.session === "") return null;
  if (typeof value.agent !== "string" || !isTerminalAgent(value.agent) || !isNullableString(value.account)) return null;
  return { kind: "session", session: value.session, cwd, agent: value.agent, account: value.account, title, closedAt };
}

/** The stored list, keeping every entry that still reads as one and dropping the rest. */
export function readClosedCells(value: unknown): ClosedCell[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readEntry)
    .filter((entry): entry is ClosedCell => entry !== null)
    .slice(0, RECENTLY_CLOSED_MAX);
}
