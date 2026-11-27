// Whether a Claude session is running in a project: a change to its memory then races the agent,
// which reads and writes memory as it works, so the Library warns (#3331).
import { readResumableList } from "../../composables/useDirLists";

/** Null when the session list could not be read, which is not the same as none running. */
export async function sessionRunningOrUnknown(cwd: string | null): Promise<boolean | null> {
  if (cwd === null) return false;
  const list = await readResumableList(cwd, "claude");
  return list === null ? null : list.sessions.some((session) => (session.runningKey ?? null) !== null);
}

export async function sessionRunningIn(cwd: string | null): Promise<boolean> {
  return (await sessionRunningOrUnknown(cwd)) ?? false;
}
