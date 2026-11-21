// Promoting the conversation being read (#3334): ask the server for a Claude session in its directory
// with the bundled skill asked to do it, then show that session as a grid cell.
import type { LibraryConversation } from "../../../common/library";
import type { PromoteTarget } from "../../../common/libraryPromote";
import type { RepeatTarget } from "../../../common/libraryRepeats";
import { promoteLibraryConversation, promoteLibraryRepeat, type LibraryPromoteResult } from "../../composables/libraryApi";
import { placeSpawnedChat } from "../../composables/useSpawnedChat";

type Refusals = Record<Exclude<LibraryPromoteResult["kind"], "started">, string>;

/** The sentence for each way a promote was refused. */
export const PROMOTE_REFUSALS: Refusals = {
  gone: "libraryView.promote.gone",
  "no-dir": "libraryView.promote.noDir",
  failed: "libraryView.promote.failed",
};

/** The same for a repeated instruction, which names no conversation. */
export const REPEAT_REFUSALS: Refusals = {
  gone: "libraryView.repeats.gone",
  "no-dir": "libraryView.repeats.noDir",
  failed: "libraryView.promote.failed",
};

/** Null when the session was started and handed to the grid, else the refusal's sentence key. */
export async function startPromote(conversation: LibraryConversation, target: PromoteTarget): Promise<string | null> {
  return placed(await promoteLibraryConversation(conversation.id, conversation.cwd, target), PROMOTE_REFUSALS);
}

/** The same for an instruction typed again and again (#3334). */
export async function startRepeatPromote(id: string, target: RepeatTarget): Promise<string | null> {
  return placed(await promoteLibraryRepeat(id, target), REPEAT_REFUSALS);
}

function placed(result: LibraryPromoteResult, refusals: Refusals): string | null {
  if (result.kind !== "started") return refusals[result.kind];
  // The seed runs at once (the skill asks before it writes anything), so the cell is no draft.
  placeSpawnedChat({ id: result.chatId, agent: "claude", draft: false });
  return null;
}
