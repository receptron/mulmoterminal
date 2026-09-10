import { ref, watch } from "vue";
import { readStored, writeStored } from "../utils/localStore";

// Where the chat sits relative to the collection it is about (#2001): UNDER it, wide and short, or
// BESIDE it, narrow and tall. Which one reads better is a property of the window and of what is
// being read — a list of cards wants the width, a record you are discussing wants the height — so
// it is the user's choice rather than a layout this decides for them.
//
// One ref, shared: the overlay lays the two out (it owns the flex direction) and the pane sizes
// itself along whichever axis it is docked on. A prop would not do — they are siblings.
export type ChatDock = "bottom" | "right";

const DOCK_KEY = "mt-collection-chat-dock";

/** Anything that is not the alternative is the default. Storage is a string anyone can write, and a
 *  value neither layout describes would leave the pane sized along an axis it is not on. */
export const parseChatDock = (raw: string | null): ChatDock => (raw === "right" ? "right" : "bottom");

// Best-effort on both sides: this is read at module scope, and a browser with site data blocked
// throws on the access rather than answering null — which would take the whole feature down for a
// preference nobody would miss (Codex, PR #2016).
export const collectionChatDock = ref<ChatDock>(parseChatDock(readStored(DOCK_KEY)));
watch(collectionChatDock, (dock) => writeStored(DOCK_KEY, dock));

export const toggleCollectionChatDock = (): void => {
  collectionChatDock.value = collectionChatDock.value === "bottom" ? "right" : "bottom";
};
