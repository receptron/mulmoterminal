// Whether a Claude session is running in a project: a change to its memory then races the agent,
// which reads and writes memory as it works, so the Library warns (#3331).
import { readResumableList } from "../../composables/useDirLists";

export async function sessionRunningIn(cwd: string | null): Promise<boolean> {
  const list = cwd === null ? null : await readResumableList(cwd, "claude");
  return (list?.sessions ?? []).some((session) => (session.runningKey ?? null) !== null);
}
