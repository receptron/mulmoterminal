// Promoting the conversation being read (#3334): ask the server for a Claude session in its directory
// with the bundled skill asked to do it, then show that session as a grid cell.
import type { LibraryConversation } from "../../../common/library";
import type { PromoteTarget } from "../../../common/libraryPromote";
import { promoteLibraryConversation, type LibraryPromoteResult } from "../../composables/libraryApi";
import { placeSpawnedChat } from "../../composables/useSpawnedChat";

/** The sentence for each way a promote was refused. */
export const PROMOTE_REFUSALS: Record<Exclude<LibraryPromoteResult["kind"], "started">, string> = {
  gone: "libraryView.promote.gone",
  "no-dir": "libraryView.promote.noDir",
  failed: "libraryView.promote.failed",
};

/** Null when the session was started and handed to the grid, else the refusal's sentence key. */
export async function startPromote(conversation: LibraryConversation, target: PromoteTarget): Promise<string | null> {
  const result = await promoteLibraryConversation(conversation.id, conversation.cwd, target);
  if (result.kind !== "started") return PROMOTE_REFUSALS[result.kind];
  // The seed runs at once (the skill asks before it writes anything), so the cell is no draft.
  placeSpawnedChat({ id: result.chatId, agent: "claude", draft: false });
  return null;
}
