// Bridges the collection plugin's chat capabilities to MulmoTerminal's terminal.
// The plugin calls startChat(prompt, role) / startNewChatDraft(prompt) from contexts
// with no active chat (the collections index "create" button, a collection/record
// action like Repair, the new-collection template cards). We spawn a fresh terminal
// session via the server's spawnBackgroundChat, and — unless `hidden` — select it so
// the user SEES it in the terminal (App.vue registers the opener, which also closes
// the browse overlay).
//
// `hidden` defaults to false: a collection action's chat is something the user should
// watch, so we surface it. A future hidden=true caller would leave it in the sidebar.
// `draft` (startNewChatDraft) prefills the prompt in claude's input box WITHOUT
// submitting, so the user can review / edit before pressing Enter; without it the
// prompt is auto-sent as claude's first turn (startChat / actions).

import { ref } from "vue";

export type Agent = "claude" | "codex";
type OpenSessionFn = (sessionId: string, opts?: { draft?: boolean; agent?: Agent }) => void;
let openSessionFn: OpenSessionFn | null = null;

// Which agent a collection action / chat spawns. Bound to the Claude/Codex toggle in the
// collection browser (CollectionsBrowseOverlay); persists across opens. Reactive so the toggle
// reflects it.
export const launchAgent = ref<Agent>("claude");

/** App.vue registers how to make a session visible (close the overlay + select it).
 *  `opts.draft` lets it show a "preparing draft…" hint while claude boots + the text
 *  is typed into the input box. */
export function registerChatOpener(fn: OpenSessionFn): void {
  openSessionFn = fn;
}

/** Spawn a new chat seeded with `prompt`; when not hidden, make it visible. With
 *  `draft`, the prompt is prefilled in the input box but NOT submitted. */
export async function startCollectionChat(prompt: string, opts: { hidden?: boolean; draft?: boolean } = {}): Promise<void> {
  const message = prompt.trim();
  if (!message) return;
  const agent = launchAgent.value;
  // codex has no editable-draft path (it auto-runs the seed), so a draft only applies to claude.
  const draft = agent === "claude" && opts.draft === true;
  let chatId: string | undefined;
  try {
    const res = await fetch("/api/plugin/spawnBackgroundChat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, draft, agent }),
    });
    if (!res.ok) {
      console.error(`[startChat] spawn failed: HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { jsonData?: { chatId?: unknown } };
    chatId = typeof data?.jsonData?.chatId === "string" ? data.jsonData.chatId : undefined;
  } catch (err) {
    console.error("[startChat] spawn failed", err);
    return;
  }
  // hidden=false → bring the new terminal session into view for the user (as the right agent).
  if (chatId && !opts.hidden) openSessionFn?.(chatId, { draft, agent });
}
