// The acting directory's past conversations as command-palette rows (#2498): the launch panel's
// resume list, minus what cannot be resumed from here. Pure.
import { cellForPanelResume } from "../components/launchCell";
import type { Cell } from "../components/gridTabs";
import type { ResumableList, ResumableSession } from "./useDirLists";
import type { TerminalAgent } from "../../common/sessionAgent";

export interface PaletteResume {
  /** What the cell resumes by: the running key when the session is still running, else its id. */
  id: string;
  title: string;
  mtime: number;
  /** The directory the list was read for, which the resumed cell runs in. */
  cwd: string | null;
  account: string | null;
}

// Held by another client, or already open in this grid: resuming it again would take it away from
// whoever has it, which the launch panel refuses too.
export const isBusyResume = (session: Pick<ResumableSession, "id" | "attached" | "runningKey">, openSessionIds: readonly string[]): boolean =>
  session.attached === true || openSessionIds.includes(session.id) || (typeof session.runningKey === "string" && openSessionIds.includes(session.runningKey));

export function paletteResumes(list: ResumableList, openSessionIds: readonly string[]): PaletteResume[] {
  return list.sessions
    .filter((session) => !isBusyResume(session, openSessionIds))
    .map((session) => ({ id: session.runningKey ?? session.id, title: session.title, mtime: session.mtime, cwd: list.cwd, account: session.account ?? null }));
}

// One conversation id can appear under two logins (#2215), and they are different rows.
export const paletteResumeId = ({ id, account }: PaletteResume): string => `${account ?? ""}:${id}`;

export const sameResume = (a: PaletteResume, b: PaletteResume): boolean => paletteResumeId(a) === paletteResumeId(b);

export const cellForPaletteResume = ({ id, cwd, account }: PaletteResume, agent: TerminalAgent): Omit<Cell, "uid"> =>
  cellForPanelResume({ id, cwd, agent, account });
