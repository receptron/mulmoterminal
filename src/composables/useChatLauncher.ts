// Bridges the collection plugin's `startChat` capability to MulmoTerminal's terminal.
// The plugin calls startChat(prompt, role) from contexts with no active chat (the
// collections index "create" button, a collection/record action like Repair). We
// spawn a fresh terminal session seeded with the prompt (the server's
// spawnBackgroundChat), and — unless `hidden` — select it so the user SEES it in the
// terminal (App.vue registers the opener, which also closes the browse overlay).
//
// `hidden` defaults to false: a collection action's chat is something the user should
// watch, so we surface it. A future hidden=true caller would leave it in the sidebar.

let openSessionFn: ((sessionId: string) => void) | null = null;

/** App.vue registers how to make a session visible (close the overlay + select it). */
export function registerChatOpener(fn: (sessionId: string) => void): void {
  openSessionFn = fn;
}

/** Spawn a new chat seeded with `prompt`; when not hidden, make it visible. */
export async function startCollectionChat(prompt: string, opts: { hidden?: boolean } = {}): Promise<void> {
  const message = prompt.trim();
  if (!message) return;
  let chatId: string | undefined;
  try {
    const res = await fetch("/api/plugin/spawnBackgroundChat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
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
  // hidden=false → bring the new terminal session into view for the user.
  if (chatId && !opts.hidden) openSessionFn?.(chatId);
}
