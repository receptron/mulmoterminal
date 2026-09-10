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
import { activeCollectionProjectId } from "./collectionSurface";
import { asTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { placeSpawnedChat, type SpawnedChatRequest } from "./useSpawnedChat";
import { currentCollectionChatKey, currentCollectionSlug } from "./useCollectionBrowse";
import { dropCollectionChat, holdCollectionChat } from "./collectionChatSessions";
import { seedCollectionCanvas } from "./seedCollectionCanvas";
import { parseCollectionSlashSeed } from "../../common/collectionSeed";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

export type Agent = TerminalAgent;

// Which agent a collection action / chat spawns. Bound to the "Launch with" dropdown in the
// collection browser (CollectionsBrowseOverlay); persisted in localStorage so the choice
// survives reloads.
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
/** Place a spawned chat as a grid cell, and file it under the collection it was started from.
 *
 *  It is an ordinary cell either way; the collection is a second place to SEE it from (the pane
 *  there shows it by having the grid teleport that cell). What the collection changes is where the
 *  reader is left: `reveal: false` places the cell without taking the screen to the grid (#2001).
 *
 *  Unfiled again if the grid could not take it — a full grid leaves the session waiting with no
 *  cell, and a tab pointing at a cell that does not exist is worse than no tab. */
function placeChat(request: SpawnedChatRequest, filingKey: string | null): void {
  if (filingKey) holdCollectionChat(filingKey, request);
  if (!placeSpawnedChat(request, { reveal: !filingKey }) && filingKey) dropCollectionChat(filingKey, request.id);
}

/** Which collection a chat is ABOUT, for the mark its cell wears (#2020).
 *
 *  The SEED first, and that is what makes this work from places the filing key cannot see: an
 *  action, a starter and a custom view's button all build `/<slug> …` (skillCommandSeed), and they
 *  are pressed from a Canvas card as often as from the open browser — where the route says
 *  nothing and `currentCollectionChatKey()` is null. Where there is no slash seed, the collection
 *  being looked at is the answer.
 *
 *  Neither source is trusted to name a real collection: `/deep-research` parses exactly like a
 *  collection seed, and so does a FEED's slug. The server resolves the slug against the project's
 *  own collections — refusing anything whose source is not one (`resolveSpawnCollection`) — and
 *  records nothing when it finds none, so a miss costs a mark rather than showing a wrong one. */
function chatCollectionSlug(message: string): string | null {
  return parseCollectionSlashSeed(message)?.slug ?? currentCollectionSlug();
}

export async function startCollectionChat(
  prompt: string,
  opts: { hidden?: boolean; draft?: boolean; project?: string | null } = {},
): Promise<SpawnedChat | null> {
  const message = prompt.trim();
  if (!message) return null;
  // Where this was asked from, read now rather than after the spawn: the request below is awaited,
  // and moving to another collection meanwhile must not file the chat where you landed.
  const filingKey = currentCollectionChatKey();
  const agent = launchAgent.value;
  // codex has no editable-draft path (it auto-runs the seed), so a draft only applies to claude.
  const draft = agent === "claude" && opts.draft === true;
  let chatId: string | undefined;
  try {
    const res = await fetchWithTimeout(
      "/api/plugin/spawnBackgroundChat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The chat runs where the collection it was started from lives. Without this a starter
        // or action pressed in a project's Collections pane seeds a prompt full of that project's
        // paths and then opens a terminal standing in the workspace.
        // The CALLER's project when it has one — a chat started from a card belongs to the
        // project that card was made in, not to whatever surface is on screen when the button is
        // pressed. Only the ambient answer is a default, for every caller that is the surface.
        body: JSON.stringify({
          message,
          draft,
          agent,
          project: opts.project === undefined ? activeCollectionProjectId() : opts.project,
          collection: chatCollectionSlug(message),
        }),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (!res.ok) {
      console.error(`[startChat] spawn failed: HTTP ${res.status}`);
      return null;
    }
    const data: unknown = await res.json();
    const jsonData = isRecord(data) ? data.jsonData : undefined;
    const id = isRecord(jsonData) ? jsonData.chatId : undefined;
    chatId = typeof id === "string" ? id : undefined;
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
    const request = { id: chatId, agent, draft, canvas };
    placeChat(request, filingKey);
  }
  // `agent` is what the route was ASKED for, and the route echoes it back in jsonData — so this is
  // the agent the PTY actually runs, not a second reading of the toggle.
  return chatId ? { id: chatId, agent } : null;
}
