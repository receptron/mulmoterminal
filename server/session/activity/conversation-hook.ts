// Pure decision for which hooks may tell us the id claude currently calls itself (#1749).
//
// Hooks reach us from every process that inherited the cell's `--settings`, not only the one the
// cell is talking to. Claude Code's pre-warmed background spare posts `SessionStart` `startup` under
// an id of its own (measured on 2.1.332), and at teardown every process posts `SessionEnd` in no
// fixed order. Neither id is where the cell's conversation goes on, and nothing is lost by skipping
// them: a fresh cell's claude starts under our id, and every move announces itself as clear /
// resume / fork (#3544).

export function speaksForConversation(event: string, source: unknown): boolean {
  if (event === "SessionEnd") return false;
  return !(event === "SessionStart" && source === "startup");
}
