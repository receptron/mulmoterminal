// The cells closed most recently, so one closed by accident can be found and reopened (#2800).
// Pure: the list is passed in and handed back, and the clock is an argument.
import { isRecord } from "../../common/isRecord";
import { asTerminalAgent, isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { cellForPanelResume } from "../components/launchCell";
import { isRemoteHost } from "../components/remoteCell";
import { isRemoteHostId } from "../../common/remoteHosts";
import { isShellLauncher, shellCell, type Cell } from "../components/gridTabs";
import type { SessionMetaView } from "../components/rosterPhase";

/** Where the cell ran (#3506): present only for a remote host, so a local entry is stored as it always was. */
type OnHost = { remoteHost?: string };

/** An agent's conversation, resumed by its session id; or a shell, which comes back fresh. */
export type ClosedCell =
  | ({ kind: "session"; session: string; cwd: string | null; agent: TerminalAgent; account: string | null; title: string; closedAt: number } & OnHost)
  | ({ kind: "shell"; cwd: string | null; title: string; closedAt: number } & OnHost);

const onHost = (remoteHost: string | null | undefined): OnHost => (isRemoteHost(remoteHost) ? { remoteHost } : {});

export const RECENTLY_CLOSED_MAX = 20;

const basename = (path: string | null): string => (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

/** What the roster would call the session: the user's memo first, then their `/rename` name, then the agent's title, then the prompt. */
export const closedTitle = (meta: Pick<SessionMetaView, "memo" | "customTitle" | "aiTitle" | "agentTitle" | "lastPrompt"> | undefined): string | null =>
  meta ? (meta.memo ?? meta.customTitle ?? meta.aiTitle ?? meta.agentTitle ?? meta.lastPrompt) : null;

/** What reopening `cell` needs, or null for a cell there is nothing to reopen of. A command cell is
 *  ephemeral, and a configured launcher is addressed by its position in a list that may have moved. */
export function closedCellOf(cell: Cell, title: string | null, now: number): ClosedCell | null {
  if (cell.command) return null;
  const shown = title?.trim() || basename(cell.cwd);
  const host = onHost(cell.remoteHost);
  if (cell.launcher) return isShellLauncher(cell.launcher) ? { kind: "shell", cwd: cell.cwd, title: shown, closedAt: now, ...host } : null;
  if (cell.session === null) return null;
  const account = cell.account ?? null;
  return { kind: "session", session: cell.session, cwd: cell.cwd, agent: asTerminalAgent(cell.agent), account, title: shown, closedAt: now, ...host };
}

/** Tells two entries apart: the same conversation under two logins is two entries (#2215). */
// A remote entry is prefixed by its host: the same directory path on two machines is two shells.
export const closedCellId = (entry: ClosedCell): string => {
  const local = entry.kind === "session" ? `session:${entry.account ?? ""}:${entry.session}` : `shell:${entry.cwd ?? ""}`;
  return entry.remoteHost === undefined ? local : `remote:${entry.remoteHost}:${local}`;
};

/** The list with `entry` first; closing the same thing again moves it up rather than listing it twice. */
export function rememberClosed(list: readonly ClosedCell[], entry: ClosedCell): ClosedCell[] {
  const id = closedCellId(entry);
  return [entry, ...list.filter((other) => closedCellId(other) !== id)].slice(0, RECENTLY_CLOSED_MAX);
}

export const forgetClosed = (list: readonly ClosedCell[], entry: ClosedCell): ClosedCell[] => {
  const id = closedCellId(entry);
  return list.filter((other) => closedCellId(other) !== id);
};

/** The entries worth offering: a conversation the grid has open again is not closed any more, and
 *  one on a host since removed from the config would reopen as a cell that cannot connect. The entry
 *  is hidden, not forgotten, so adding the host back brings it back. */
export const reopenableClosed = (
  list: readonly ClosedCell[],
  openSessionIds: readonly string[],
  hostGone: (host: string) => boolean = () => false,
): ClosedCell[] =>
  list.filter(
    (entry) => (entry.kind === "shell" || !openSessionIds.includes(entry.session)) && (entry.remoteHost === undefined || !hostGone(entry.remoteHost)),
  );

export const cellForClosed = (entry: ClosedCell): Omit<Cell, "uid"> => ({
  ...(entry.kind === "session" ? cellForPanelResume({ id: entry.session, cwd: entry.cwd, agent: entry.agent, account: entry.account }) : shellCell(entry.cwd)),
  ...onHost(entry.remoteHost),
});

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

function readEntry(value: unknown): ClosedCell | null {
  if (!isRecord(value) || !isNullableString(value.cwd) || typeof value.title !== "string") return null;
  if (typeof value.closedAt !== "number" || !Number.isFinite(value.closedAt)) return null;
  // A host that is not a valid id drops the entry: reopening it locally would be the wrong machine.
  if (value.remoteHost !== undefined && !isRemoteHostId(value.remoteHost)) return null;
  const { cwd, title, closedAt } = value;
  const host = onHost(value.remoteHost);
  if (value.kind === "shell") return { kind: "shell", cwd, title, closedAt, ...host };
  if (value.kind !== "session" || typeof value.session !== "string" || value.session === "") return null;
  if (typeof value.agent !== "string" || !isTerminalAgent(value.agent) || !isNullableString(value.account)) return null;
  return { kind: "session", session: value.session, cwd, agent: value.agent, account: value.account, title, closedAt, ...host };
}

/** The stored list, keeping every entry that still reads as one and dropping the rest. */
export function readClosedCells(value: unknown): ClosedCell[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(readEntry)
    .filter((entry): entry is ClosedCell => entry !== null)
    .slice(0, RECENTLY_CLOSED_MAX);
}
