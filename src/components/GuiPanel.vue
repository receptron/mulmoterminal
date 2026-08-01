<script setup lang="ts">
import { ref, computed, watch, nextTick, type ComponentPublicInstance } from "vue";
import { useSessionFeed } from "../composables/useSessionFeed";
import { onToolGroupsAnnounced } from "../composables/useToolGroupsAnnounce";
import { getPlugin } from "../plugins-registry";
import PluginFrame from "./PluginFrame.vue";
import { TOOL_GROUPS, groupOfTool, toolsInGroup } from "../../common/toolGroups";
import { reconcileCollectionCard } from "../../common/collectionSeed";
import { collapseByIdentity } from "../utils/canvasCollapse";

// The GUI panel renders the toolResults produced by GUI-protocol plugins. It
// mirrors the terminal's active session: live results arrive on that session's
// pub/sub channel, history is replayed from /api/agent/toolResults/:id on (re)select.
// Each result is rendered by its plugin's viewComponent (getPlugin(toolName)) — no
// hard-coded type switch. See the spike doc.
interface ToolResult {
  uuid: string;
  toolName: string;
  title?: string;
  message?: string;
  data?: unknown;
  jsonData?: unknown;
  viewState?: unknown;
}

const props = defineProps<{
  sessionId: string | null;
  sendTextMessage: (text: string) => boolean;
  toolsOpen?: boolean;
  // Why this panel cannot show anything, when that is knowable. The pane outlives the cell it
  // was opened on — walking the zoom to a launcher or to a directory with no render MCP leaves
  // it mounted — and the empty-state hint below ("ask Claude to use one of these") is a LIE in
  // both cases: there is nothing to ask, or nothing that could answer. Absent/null means the
  // panel is usable, which keeps the single view (where it always is) unchanged.
  unavailable?: "no-session" | "no-canvas-mcp" | null;
}>();
const emit = defineEmits<{ toggleTools: [] }>();

const results = ref<ToolResult[]>([]);

// Auto-follow state. Declared HERE, above useSessionFeed: its session watcher is `immediate`, so
// the onSessionChange below runs during that call — a declaration further down would still be in
// its temporal dead zone when it fires.
const scrollRef = ref<HTMLElement | null>(null);
// True while the reader is still on the newest card — see followNewestCard() for what that means
// and why it is not "parked at the bottom". A reader who scrolled UP to an earlier card must not
// be yanked away from it (MulmoClaude's StackView #2179).
const followNewest = ref(true);
// How far above the newest card's top edge still counts as being on it, so the gate survives the
// small drift of reading and does not flip on a one-pixel overshoot.
const FOLLOW_THRESHOLD_PX = 80;

// Deduping by uuid mirrors applyToolResultToSession.
const { upsert } = useSessionFeed(results, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/agent/toolResults/${encodeURIComponent(id)}`,
  historyKey: "toolResults",
  channel: (id) => `session:${id}`,
  identify: (result) => result.uuid,
  // The one pair uuid dedupe cannot relate: a collection placeholder seeded by the browser at
  // spawn, and the agent's own presentCollection card for the same collection. Different writers,
  // different uuids, one thing on screen — the real card wins. The server applies the same rule to
  // what it stores, so a reload agrees with what is here now.
  reconcile: (list, incoming) => reconcileCollectionCard(list, incoming),
  // Drop the previous session's views the moment the session changes, rather than when its
  // replacement's history arrives: until then the panel would still be showing another cell's
  // drawings under this cell's name.
  //
  // Re-arming the auto-follow gate is part of the same reset: having scrolled up in the cell you
  // came from must not decide where you land in the one you switched to, and arriving on the
  // newest card is the point of the follow.
  onSessionChange: () => {
    results.value = [];
    followNewest.value = true;
  },
});

// A plugin view changed its state (e.g. a form field edited / submitted). Per the
// gui-chat-protocol contract the view may emit a PARTIAL ToolResult (e.g. just
// `{ viewState }`), so merge it into the existing result rather than replacing —
// otherwise data/jsonData/uuid/toolName would be lost.
//
// `persistOnly` is a deliberate trade-off: the view emits on every change, and
// without it the server would re-publish on the session channel straight back to
// THIS panel — the echo arrives with fresh object identity, the view treats it as a
// new result and re-seeds, re-emitting → an infinite flicker loop. So we suppress
// the broadcast and rely on the local upsert() above. The cost: a second browser
// tab on the same session won't see live view-state updates (it picks them up on
// reload from the stored result) — acceptable for a local single-client tool.
async function onUpdateResult(existing: ToolResult, update: Partial<ToolResult>) {
  const merged: ToolResult = { ...existing, ...update };
  upsert(merged);
  if (!props.sessionId) return;
  try {
    await fetch("/api/agent/toolResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...merged, sessionId: props.sessionId, persistOnly: true }),
    });
  } catch {
    // Best-effort persistence; the live view already updated.
  }
}

const hasContent = computed(() => results.value.length > 0);

// What a result IS, for the purpose of "this is the same thing you already drew". The plugin
// decides (Registration.identityOf); the toolName prefix is added here so two plugins returning
// the same string — a collection slug that happens to read like a path — stay separate.
function cardIdentity(result: ToolResult): string | null {
  const identity = getPlugin(result.toolName)?.identityOf?.(result) ?? null;
  return identity === null ? null : `${result.toolName}:${identity}`;
}

// The cards actually rendered: one per identity, newest at that identity's newest position. See
// canvasCollapse.ts for why the superseded ones are dropped rather than kept as members.
const cards = computed(() => collapseByIdentity(results.value, cardIdentity));

// v-for key. The UUID, deliberately — NOT the identity, which would look like the tidier choice
// (same subject, same key, one instance kept across edits) and is the wrong one.
//
// The remount IS the refresh. A re-presented card is meant to show state that CHANGED, and the
// views have no other way to learn that. The collection View reloads from a
// `watch(activeSlug, …)`: re-presenting the same collection leaves that slug identical, so the
// watch never fires, and MulmoTerminal does not configure the package's optional
// `subscribeChanges` hook (see src/composables/collectionUi.ts) that would otherwise push the
// change in. Keeping the instance therefore keeps its STALE contents — a card that collapsed to
// "the newest" while rendering the oldest, which is worse than the stacking this replaces.
// presentHtml's iframe and presentDocument's rendered body are the same story.
//
// What is lost is what the view held internally — the table's scroll position, expanded rows —
// and that is exactly what today's behaviour already loses, since today every edit draws a whole
// new card. Correct-and-unchanged beats stale-but-smooth. Caught by Codex on PR #1223; pinned by
// "remounts the view … so it refetches" in GuiPanelCollapse.spec.ts.
const cardKey = (result: ToolResult) => result.uuid;

// Auto-follow. The pane never scrolled itself, so each new card landed below the fold and the
// user had to go find it. State is declared above useSessionFeed.
//
// It follows the newest card's TOP edge, not the bottom of the pane. Scrolling to the bottom is
// the obvious reading of "show me the newest" and it is wrong for anything you READ: a long
// presentDocument flows at its natural height, so the end of the pane is the end of the DOCUMENT
// — the reader is dropped at the last line of something they have not started. Anchoring on the
// card's top shows every card from its beginning, whatever its height.
//
// It is also the more robust anchor. A card's rendered height settles after we scroll (markdown
// layout, images, an iframe reporting its height), and a bottom anchor computed before that lands
// somewhere arbitrary once the content grows. The top edge of the LAST card does not move when
// that card grows.

// Each rendered card's root element, so the newest one's position can be measured.
const cardEls = new Map<string, HTMLElement>();
function setCardEl(uuid: string, el: Element | ComponentPublicInstance | null) {
  if (!el) {
    cardEls.delete(uuid);
    return;
  }
  // A function ref on a component receives the instance; PluginFrame has a single root element.
  const node = el instanceof Element ? el : (el.$el as unknown);
  if (node instanceof HTMLElement) cardEls.set(uuid, node);
}

/**
 * The `scrollTop` that puts the newest card's top edge flush with the top of the pane — CLAMPED to
 * the furthest the pane can actually scroll. Null before anything is laid out.
 *
 * The clamp is the whole reason this is one function instead of two. A newest card shorter than
 * the pane, under tall earlier content, has a top edge BEYOND the maximum legal scrollTop: the
 * assignment lands short of it, which is exactly right (the short card ends up fully visible), but
 * it means the reachable position is not `top`. The gate below has to compare against the same
 * reachable position, or the pane's own jump reads as the reader having scrolled up and switches
 * following off — for a reader who never touched anything. Caught by Codex on PR #1224.
 */
function followAnchor(): number | null {
  const container = scrollRef.value;
  const newest = cards.value[cards.value.length - 1];
  const card = newest ? cardEls.get(newest.uuid) : undefined;
  if (!container || !card) return null;
  const top = card.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  const furthest = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(top, furthest);
}

function onScroll() {
  const container = scrollRef.value;
  const anchor = followAnchor();
  // Nothing to follow away from yet.
  if (!container || anchor === null) return;
  // "Still on the newest card" — at the anchor, or anywhere further down inside the card. Scrolling
  // UP past it is the deliberate act of going back to something earlier, and only that closes the
  // gate. Since the jump below lands exactly on this same anchor, a programmatic scroll re-AFFIRMS
  // the gate rather than cancelling it, so no suppression flag is needed.
  followNewest.value = container.scrollTop >= anchor - FOLLOW_THRESHOLD_PX;
}

// Changes when a card is added, or when a DIFFERENT result takes the last slot (a re-presented
// collection moving down from above). Deliberately NOT sensitive to a view persisting its own
// state: onUpdateResult replaces the object but keeps its uuid, and chasing a form's every
// keystroke would fight the person typing into it.
const latestCardKey = computed(() => {
  const list = cards.value;
  const last = list[list.length - 1];
  return `${list.length}:${last?.uuid ?? ""}`;
});

watch(latestCardKey, () => {
  if (!followNewest.value) return;
  // After the new card is in the DOM, so it has a position to measure.
  nextTick(() => {
    const container = scrollRef.value;
    const top = followAnchor();
    // Already clamped to the furthest the pane can scroll, which is what makes a SHORT newest card
    // come out fully visible rather than pinned to the top with empty space under it.
    if (container && top !== null) container.scrollTop = top;
  });
});

// What each tool produces, so the empty state says what asking for one would get rather than
// only naming it. A Map for the same reason common/toolGroups.ts uses one, and consulted with a
// fallback: the NAMES come from the group table, so a tool added there shows up here
// immediately — unnamed rather than missing, which is the failure that is noticed.
const TOOL_HINTS = new Map<string, string>([
  ["presentDocument", "a formatted document, written in markdown"],
  ["presentForm", "a form to fill in and send back"],
  ["presentChart", "a chart from a set of data"],
  ["presentHtml", "a self-contained web page"],

  ["presentCollection", "a collection from this workspace, laid out to browse"],
  ["manageCollection", "reads and writes those collections and their schemas"],
  ["manageAccounting", "reads and writes the workspace's books"],

  ["generateImage", "an image generated from a prompt"],
  ["presentMulmoScript", "a MulmoScript presentation, built and played here"],

  ["google", "your linked Google account: Calendar, Tasks, Drive"],
  ["readXPost", "one post on X, fetched by URL or id"],
  ["searchX", "recent posts on X matching a query"],
]);

// The tools the SERVER says this session has, asked for rather than reconstructed from the group
// table. Two things make the static answer wrong: a grid cell reaches only the groups its
// directory registered, and a plugin whose requiredEnv is unmet (searchX without X_BEARER_TOKEN)
// is dropped at load — naming either in the hint below sends the user to a tool that was never
// offered. `null` until the answer lands, which is NOT the same as "no tools": see toolSections.
const availableTools = ref<string[] | null>(null);

async function loadAvailableTools(sessionId: string | null) {
  availableTools.value = null;
  try {
    const res = await fetch(sessionId ? `/api/tools?sessionId=${encodeURIComponent(sessionId)}` : "/api/tools");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // Late reply for a session we have since walked away from would list another cell's tools.
    if (sessionId !== props.sessionId) return;
    if (!Array.isArray(body.tools)) return;
    availableTools.value = body.tools.map((tool: { toolName?: unknown }) => tool?.toolName).filter((name: unknown): name is string => typeof name === "string");
  } catch {
    // Leave it unknown rather than empty — the hint falls back to the full list, which is a
    // better answer than telling a working session it has nothing.
  }
}
watch(() => props.sessionId, loadAvailableTools, { immediate: true });

// The answer above is normally asked BEFORE it can be true: the browser is handed a session id
// while claude is still being spawned, so its MCP client has not connected to the group URLs yet
// and the server has not learned which tools this cell got.
onToolGroupsAnnounced((announcement) => {
  if (announcement.sessionId === props.sessionId) loadAvailableTools(props.sessionId);
});

// What this session can be asked for, grouped. Ordered by TOOL_GROUPS (blast radius, least
// first) rather than by the order the server happened to list them, so the hint does not
// reshuffle between cells, and a group with nothing available drops out entirely.
//
// While the answer is unknown, every group's members — the full list is what the panel showed
// before it could ask at all, and it beats an empty one during the moment after a cell switch.
const toolSections = computed(() =>
  TOOL_GROUPS.map((group) => {
    const known = availableTools.value;
    const names = known ? known.filter((name) => groupOfTool(name) === group) : toolsInGroup(group);
    // toolsInGroup order, not the server's: the group table is where the reading order was chosen.
    const ordered = toolsInGroup(group).filter((name) => names.includes(name));
    return { group, tools: ordered.map((name) => ({ name, hint: TOOL_HINTS.get(name) ?? "" })) };
  }).filter((section) => section.tools.length > 0),
);

// A session with no GUI tools at all. The grid never reaches this — it reports `unavailable`
// first, and that outranks — but "ask Claude to use one of these:" above an EMPTY list is a
// dead end for any caller that does, so the hint is dropped rather than left dangling.
const hasTools = computed(() => toolSections.value.some((section) => section.tools.length > 0));
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-deep">
    <div class="py-2 px-4 bg-panel text-fg font-sans text-[14px] flex items-center justify-between">
      <span class="font-semibold">Canvas</span>
      <button
        v-if="!toolsOpen"
        type="button"
        class="bg-transparent border-0 text-dim text-[15px] leading-none py-0.5 px-1 cursor-pointer rounded hover:text-fg"
        title="Tools & tool-call history"
        aria-label="Open tools pane"
        @click="emit('toggleTools')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">build</span>
      </button>
    </div>
    <div ref="scrollRef" data-testid="canvas-scroll" class="flex-1 overflow-y-auto px-4 py-3 font-sans text-[14px] leading-normal text-fg" @scroll="onScroll">
      <!-- Unavailable outranks empty: both look like "nothing here", but only one of them is
           something the user can act on by talking to the agent. -->
      <div v-if="unavailable" data-testid="canvas-unavailable" class="text-[13px] text-dim">
        <template v-if="unavailable === 'no-session'">
          <div class="font-medium text-secondary">No session here</div>
          <p class="mt-1">This cell has no terminal running yet. Start one and its drawings will appear here.</p>
        </template>
        <template v-else>
          <!-- The SESSION, not the directory. The tools are handed to the agent when it starts,
               so a session begun before the switch was turned on has none of them while the
               directory it runs in is enabled — saying "directory" there sends the user to a
               switch that is already on. -->
          <div class="font-medium text-secondary">Canvas is not enabled for this session</div>
          <p class="mt-1">
            Its agent was started without the drawing tools, so nothing can appear here. They are handed out at startup: turn on
            <span class="whitespace-nowrap font-medium">CANVAS (render MCPs)</span> — or <span class="whitespace-nowrap font-medium">CANVAS (media MCPs)</span>,
            for generated images and MulmoScript — in this cell's launcher, then restart the cell.
          </p>
        </template>
      </div>
      <!-- Grouped, and the group is named: the switches in the launcher are per group, so a user
           who wants a tool that isn't listed needs to know WHICH one to turn on. The heading is
           dropped when there is only one — naming a division of one explains nothing. -->
      <div v-else-if="!hasContent && !hasTools" data-testid="canvas-no-tools" class="text-[13px] text-dim">This session has no GUI tools.</div>
      <div v-else-if="!hasContent" data-testid="canvas-empty" class="text-[13px] text-dim">
        Ask Claude to use one of these:
        <div v-for="section in toolSections" :key="section.group" class="mt-1.5">
          <div v-if="toolSections.length > 1" class="text-[11px] uppercase tracking-[0.05em] text-muted">{{ section.group }}</div>
          <ul class="mt-1 list-disc space-y-1 pl-4 marker:text-border">
            <li v-for="tool in section.tools" :key="tool.name">
              <code class="rounded-[4px] bg-subtle px-[5px] py-px">{{ tool.name }}</code>
              <template v-if="tool.hint"> &mdash; {{ tool.hint }}</template>
            </li>
          </ul>
        </div>
      </div>
      <!-- Guarded as well as cleared on session change: a stale view rendered under an
           "unavailable" heading would contradict it. -->
      <template v-for="r in unavailable ? [] : cards" :key="cardKey(r)">
        <PluginFrame
          v-if="getPlugin(r.toolName)"
          :ref="(el) => setCardEl(r.uuid, el as Element | ComponentPublicInstance | null)"
          class="[&+&]:mt-4 [&+&]:border-t [&+&]:border-border [&+&]:pt-4"
          :css="getPlugin(r.toolName)!.css"
          :height="getPlugin(r.toolName)!.height"
        >
          <component
            :is="getPlugin(r.toolName)!.viewComponent"
            :selected-result="r"
            :send-text-message="sendTextMessage"
            @update-result="(update: Partial<ToolResult>) => onUpdateResult(r, update)"
          />
        </PluginFrame>
      </template>
    </div>
  </section>
</template>

<!-- Adjacent-frame spacing is a sibling-combinator rule with no clean utility
     equivalent, so it stays scoped; everything else is utilities. -->
