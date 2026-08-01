// Bridges the collection plugin's chat capabilities to MulmoTerminal's terminal.
// The plugin calls startChat(prompt, role) / startNewChatDraft(prompt) from contexts
// with no active chat (the collections index "create" button, a collection/record
// action like Repair, the new-collection template cards, a custom view's chat button).
// We spawn a fresh terminal session via the server's spawnBackgroundChat, and — unless
// `hidden` — place it as a GRID CELL (useSpawnedChat), bringing the grid on screen if an overlay
// is over it.
//
// This function is the ONE choke point for every programmatically started chat, which is
// why the grid/single-view decision is made here rather than at each call site: the
// collection UI reaches it through the plugin's two capabilities (collectionUi.ts), and a
// custom view reaches those through the plugin from inside its iframe.
//
// `hidden` defaults to false: a collection action's chat is something the user should
// watch, so we surface it. A hidden=true caller is placing the session itself (or is a
// real background worker) and gets only the id back.
// `draft` (startNewChatDraft) prefills the prompt in claude's input box WITHOUT
// submitting, so the user can review / edit before pressing Enter; without it the
// prompt is auto-sent as claude's first turn (startChat / actions).

import { ref, watch } from "vue";
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { placeSpawnedChat } from "./useSpawnedChat";
import { seedCollectionCanvas } from "./seedCollectionCanvas";

export type Agent = TerminalAgent;

// Which agent a collection action / chat spawns. Bound to the Claude/Codex/Antigravity toggle in the collection
// browser (CollectionsBrowseOverlay); persisted in localStorage so the choice survives reloads.
const LAUNCH_AGENT_KEY = "mt-launch-agent";
const saved = localStorage.getItem(LAUNCH_AGENT_KEY);
export const launchAgent = ref<Agent>(asTerminalAgent(saved));
watch(launchAgent, (agent) => localStorage.setItem(LAUNCH_AGENT_KEY, agent));

/** A session this module started. The agent travels WITH the id because a spawn is not always
 *  Claude — `launchAgent` decides, and a caller that reads that toggle again to find out has two
 *  sources for one fact. Anything attaching to the session needs both: the wrong agent reconnects
 *  to the wrong endpoint. */
export interface SpawnedChat {
  id: string;
  agent: Agent;
}

/** Spawn a new chat seeded with `prompt`; when not hidden, make it visible. With
 *  `draft`, the prompt is prefilled in the input box but NOT submitted. Returns what was spawned
 *  (null if nothing was) — `hidden` callers need it to put the session somewhere of their own,
 *  since suppressing the opener otherwise leaves them no handle on what they started. */
export async function startCollectionChat(prompt: string, opts: { hidden?: boolean; draft?: boolean } = {}): Promise<SpawnedChat | null> {
  const message = prompt.trim();
  if (!message) return null;
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
      return null;
    }
    const data = (await res.json()) as { jsonData?: { chatId?: unknown } };
    chatId = typeof data?.jsonData?.chatId === "string" ? data.jsonData.chatId : undefined;
  } catch (err) {
    console.error("[startChat] spawn failed", err);
    return null;
  }
  // hidden=false → place the new session as a grid cell (as the right agent), navigating there
  // if the user is somewhere else. `draft` travels along: the cell must show a prompt waiting in
  // the input box rather than treat it as a turn already running.
  if (chatId && !opts.hidden) {
    // Seeded BEFORE placing, and awaited, so the cell can arrive with its Canvas already open
    // rather than rearranging itself under the user a moment later. Both are local requests
    // against a session that already exists. Seeded here for the SAME reason placement is —
    // every collection entry point passes through this one function.
    const canvas = await seedCollectionCanvas(chatId, message);
    placeSpawnedChat({ id: chatId, agent, draft, canvas });
  }
  // `agent` is what the route was ASKED for, and the route echoes it back in jsonData — so this is
  // the agent the PTY actually runs, not a second reading of the toggle.
  return chatId ? { id: chatId, agent } : null;
}
