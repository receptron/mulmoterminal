<script setup lang="ts">
import { ref, computed } from "vue";
import { useSessionFeed } from "../composables/useSessionFeed";
import { getPlugin } from "../plugins-registry";
import PluginFrame from "./PluginFrame.vue";
import { TOOL_GROUPS, toolsInGroup, type ToolGroup } from "../../common/toolGroups";

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
  // The GUI tool groups this session actually reached us on, so the empty state lists what THIS
  // terminal can be asked for rather than a fixed set — a cell with only `render` registered
  // should not be told to ask for generateImage. Absent means "everything": the single view
  // connects on the all-tools URL, where no group was ever selected (common/toolGroups.ts).
  groups?: ToolGroup[];
}>();
const emit = defineEmits<{ toggleTools: [] }>();

const results = ref<ToolResult[]>([]);

// Deduping by uuid mirrors applyToolResultToSession.
const { upsert } = useSessionFeed(results, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/agent/toolResults/${encodeURIComponent(id)}`,
  historyKey: "toolResults",
  channel: (id) => `session:${id}`,
  identify: (result) => result.uuid,
  // Drop the previous session's views the moment the session changes, rather than when its
  // replacement's history arrives: until then the panel would still be showing another cell's
  // drawings under this cell's name.
  onSessionChange: () => (results.value = []),
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

// Every group this session has, each with ALL its members — the whole of what the terminal can
// be asked for, not a sample. This is the only place the tools are named, and a user reading
// "presentDocument or presentForm" has no way to learn that a chart, a web page or an image is
// also on offer. Ordered by TOOL_GROUPS (blast radius, least first) rather than by the order the
// session happened to connect its MCP clients in, so the list does not reshuffle between cells.
const toolSections = computed(() => {
  const session = props.groups;
  const groups = session ? TOOL_GROUPS.filter((group) => session.includes(group)) : TOOL_GROUPS;
  return groups.map((group) => ({
    group,
    tools: toolsInGroup(group).map((name) => ({ name, hint: TOOL_HINTS.get(name) ?? "" })),
  }));
});

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
    <div class="flex-1 overflow-y-auto px-4 py-3 font-sans text-[14px] leading-normal text-fg">
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
      <template v-for="r in unavailable ? [] : results" :key="r.uuid">
        <PluginFrame v-if="getPlugin(r.toolName)" class="frame" :css="getPlugin(r.toolName)!.css" :height="getPlugin(r.toolName)!.height">
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
<style scoped>
.frame + .frame {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
