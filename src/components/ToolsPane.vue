<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { useSessionFeed } from "../composables/useSessionFeed";
import { onToolGroupsAnnounced } from "../composables/useToolGroupsAnnounce";
import { isRecord, optionalString } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// The tools pane mirrors MulmoClaude's right sidebar: an "Available Tools" list
// (the GUI plugin tools, with collapsible descriptions) and a "Tool Call History"
// for the active session. For a CLAUDE session the history is fed by its PreToolUse/PostToolUse
// hooks, so it shows EVERY tool call — built-ins (Bash, Read, …), other MCP tools, and our GUI
// plugin tools. For codex / agy, which have no hooks, it is fed by our MCP broker and holds the
// GUI tools alone — /api/tools reports which, as `guiOnlyHistory`. Live updates arrive on the
// toolcalls:<id> channel; history replays from /api/tool-calls/:id on (re)select.
interface AvailableTool {
  toolName: string;
  title?: string;
  description?: string;
}
// `toolName` is the field the pane cannot do without: it keys the row and is what a click sends.
// The other two are display text and may legitimately be absent — but a PRESENT one of the wrong
// type would be asserted as a string and rendered.
const isAvailableTool = (value: unknown): value is AvailableTool =>
  isRecord(value) && typeof value.toolName === "string" && optionalString(value.title) && optionalString(value.description);

interface ToolCall {
  toolUseId?: string;
  toolName: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  status: "running" | "completed" | "failed";
  at: number;
  durationMs?: number;
}

const props = defineProps<{
  sessionId: string | null;
  // Whether this pane currently covers the terminal area. Owned by the grid (it is the grid's
  // layout that changes), shown here because the button that flips it lives in this header.
  expanded?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleExpand: [] }>();

// Whether this session's history holds the GUI tools ALONE (the broker fed it) rather than every
// tool (claude's hooks fed it). An empty GUI-only history looks exactly like an agent that ran
// nothing, so the pane says which it is — see the note in the template.
//
// The SERVER decides it, and the client cannot: a codex launcher chip runs the user's own command
// through the login shell, so nothing the browser holds about that cell names an agent at all
// (server/mcp/gui-call-history.ts).
const guiOnlyHistory = ref(false);

/** The list AND the session it describes, because a list alone cannot say whose it is. Switching
 *  cells re-asks, and until the answer lands the previous session's tools were being shown as this
 *  session's — the `loading` state below could not cover it, being about an EMPTY list (#1968).
 *
 *  Paired rather than cleared on switch: clearing would also blank the pane on the re-ask a
 *  session makes when the server announces its groups, which is a good answer we already have.
 *  Pairing makes the stale state unrepresentable instead of short. */
const loadedTools = ref<{ sessionId: string | null; tools: AvailableTool[] } | null>(null);
const availableTools = computed<AvailableTool[]>(() => (loadedTools.value?.sessionId === props.sessionId ? loadedTools.value.tools : []));
const toolCalls = ref<ToolCall[]>([]);

// One call off the live channel. `toolName`, `status` and `at` are what every row renders from;
// without them there is no row to draw.
const CALL_STATUSES: readonly ToolCall["status"][] = ["running", "completed", "failed"];
function readToolCall(raw: unknown): ToolCall | null {
  if (!isRecord(raw) || typeof raw.toolName !== "string" || typeof raw.at !== "number") return null;
  const status = CALL_STATUSES.find((known) => known === raw.status);
  if (!status) return null;
  return {
    toolName: raw.toolName,
    status,
    at: raw.at,
    ...(typeof raw.toolUseId === "string" ? { toolUseId: raw.toolUseId } : {}),
    ...(raw.toolInput !== undefined ? { toolInput: raw.toolInput } : {}),
    ...(raw.toolOutput !== undefined ? { toolOutput: raw.toolOutput } : {}),
    ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
  };
}
const expandedTools = ref<Set<string>>(new Set());
const expandedCalls = ref<Set<string>>(new Set());

// NOT the same for every session any more. A grid cell reaches the GUI tools through one URL
// per group, registered in the USER's own per-folder MCP config — so two cells can have
// different tools, and the list has to be asked for per session. Without a session id the
// server answers with the whole set (the single view, which carries every tool).
//
// Reloaded on every session change rather than cached per id: the server learns a session's
// groups from the connections it makes, so the answer for one id can go from "everything" to
// the real subset within a second of that session starting.
//
// The session id is NOT enough to tell two loads apart, and since the re-ask below there are
// routinely two in flight for the id that is current — the early one asked at mount and the one
// the announcement triggered. Both pass a session-id guard, so an older reply landing second
// would restore the empty list this pane exists to get rid of. Only the newest may apply, which
// is the same rule and the same counter useSessionFeed keeps (#620).
let latestToolsLoad = 0;
/** What an EMPTY `availableTools` means right now — three different things, and it used to be one.
 *
 *  Only `known` may show the guidance below, because that guidance tells the reader to go and
 *  change their configuration. `loading` is not a formality: the pane mounts before the first
 *  response and is re-asked on every cell change, so without it every session is told "nothing is
 *  enabled" while it is still being asked (#1966). */
const toolsState = ref<"loading" | "unknown" | "known">("loading");

async function loadAvailableTools(sessionId: string | null) {
  const loadId = ++latestToolsLoad;
  const url = sessionId ? `/api/tools?sessionId=${encodeURIComponent(sessionId)}` : "/api/tools";
  // Overtaken: a load for another session (we switched away), or a newer load for this one.
  const overtaken = () => sessionId !== props.sessionId || loadId !== latestToolsLoad;
  toolsState.value = "loading";
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await jsonBody(res);
    if (overtaken()) return;
    // READABLE means the body survived parsing, not that it arrived. `jsonBody` answers `{}` for a
    // body it could not parse, and every success path of the route sends the array of well-formed
    // summaries (`tool-routes.ts:159`) — so a missing `tools`, and equally an array that yields
    // nothing, is a proxy or a version skew rather than a session with no tools. The distinction
    // is the whole point of the empty state below: "none are enabled" sends the reader off to
    // configure a folder that may be fine (#1966).
    const raw = isUnknownArray(body.tools) ? body.tools : null;
    const listed = raw === null ? null : raw.filter(isAvailableTool);
    const readable = listed !== null && raw !== null && (raw.length === 0 || listed.length > 0);
    loadedTools.value = { sessionId, tools: listed ?? [] };
    guiOnlyHistory.value = body.guiOnlyHistory === true;
    toolsState.value = readable ? "known" : "unknown";
  } catch {
    if (overtaken()) return;
    loadedTools.value = { sessionId, tools: [] };
    // Unknown, so claim nothing: a note that appears on a failed request would be a statement
    // about a history we could not ask about.
    guiOnlyHistory.value = false;
    // The same rule as the success path: an empty list we could not fill is not an answer.
    toolsState.value = "unknown";
  }
}
watch(() => props.sessionId, loadAvailableTools, { immediate: true });

// The question above is normally asked BEFORE it can be answered: the browser is handed a session
// id while the agent is still being spawned, so its MCP client has not connected and the server
// has learned no groups yet. That first "nothing" then stood until something happened to remount
// the pane — closing and reopening it, or switching cells — which is exactly the "No GUI plugin
// tools enabled." a freshly started session showed.
//
// So re-ask when the server says that session's MCP client is up. Re-asking rather than reading the
// pushed `groups`: the reply also carries the tool DESCRIPTIONS and `guiOnlyHistory`, which the push
// does not, and the announcement for a single-view session carries no groups at all (see
// mcp-routes.ts).
onToolGroupsAnnounced((announcement) => {
  if (announcement.sessionId === props.sessionId) void loadAvailableTools(props.sessionId);
});

function callKey(c: ToolCall, i: number): string {
  return c.toolUseId ?? `${c.toolName}-${i}`;
}

// Keying by tool_use_id lets a PostToolUse complete the "running" entry its
// PreToolUse created.
useSessionFeed(toolCalls, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/tool-calls/${encodeURIComponent(id)}`,
  historyKey: "toolCalls",
  channel: (id) => `toolcalls:${id}`,
  identify: (call) => call.toolUseId,
  parse: readToolCall,
  onSessionChange: () => {
    expandedCalls.value = new Set();
  },
});

function toggleTool(name: string) {
  const next = new Set(expandedTools.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expandedTools.value = next;
}
function toggleCall(key: string) {
  const next = new Set(expandedCalls.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedCalls.value = next;
}

function formatTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Copy the WHOLE tool-call history (arguments + results) as pretty JSON — handy
// to paste into a bug report / share when a run goes sideways. Mirrors
// MulmoClaude's RightSidebar copy-history button.
const historyCopied = ref(false);
let historyCopyTimer: ReturnType<typeof window.setTimeout> | undefined;
async function copyHistory(): Promise<void> {
  if (toolCalls.value.length === 0) return;
  try {
    await window.navigator.clipboard.writeText(JSON.stringify(toolCalls.value, null, 2));
    historyCopied.value = true;
    window.clearTimeout(historyCopyTimer);
    historyCopyTimer = window.setTimeout(() => {
      historyCopied.value = false;
    }, 2000);
  } catch {
    // Clipboard blocked (insecure context / permissions) — leave the hint off.
  }
}
onUnmounted(() => window.clearTimeout(historyCopyTimer));
</script>

<template>
  <section class="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-deep">
    <div class="flex items-center justify-between bg-panel px-4 py-2 font-sans text-[14px] text-fg">
      <span class="font-semibold">Tools</span>
      <!-- Expand then close, in that order, exactly as the Canvas header has them: the two panes
           share one slot, so the same control must be in the same place in both. -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          data-testid="tools-expand-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :title="expanded ? 'Restore the terminal beside the tools' : 'Expand the tools over the terminal'"
          :aria-label="expanded ? 'Restore tools pane width' : 'Expand tools pane'"
          :aria-pressed="expanded === true"
          @click="emit('toggleExpand')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
        </button>
        <button
          type="button"
          data-testid="tools-close-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          title="Close tools pane"
          aria-label="Close tools pane"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto font-sans text-[13px] text-fg">
      <!-- Available tools -->
      <div class="border-b border-border px-3 py-2.5">
        <div class="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-dim">Available Tools</div>
        <!-- Not just "there are none": someone reading this pane is here BECAUSE they expected a
             tool, and the empty state used to end the trail (#1966). Both halves are needed — the
             switch is on an empty cell's LAUNCH FORM, so it is not on screen while this session
             runs, and the registration is read when a session STARTS. Naming one without the other
             sends the reader hunting for a control that is not there. -->
        <div v-if="availableTools.length === 0 && toolsState === 'loading'" data-testid="tools-loading" class="text-[12px] text-dim">Checking…</div>
        <div v-else-if="availableTools.length === 0 && toolsState === 'unknown'" data-testid="tools-unknown" class="text-[12px] leading-relaxed text-dim">
          Could not ask this server which tools are enabled. The list below is empty because the request failed, not because nothing is registered.
        </div>
        <div v-else-if="availableTools.length === 0" data-testid="tools-empty" class="text-[12px] leading-relaxed text-dim">
          No GUI plugin tools enabled. They come from the tool groups registered for this folder — the switches are on an empty cell's launch form (<span
            class="text-secondary"
            >Workspace data</span
          >, <span class="text-secondary">Canvas</span>, <span class="text-secondary">External accounts</span>), and a session reads the registration when it
          starts, so turn one on before launching.
        </div>
        <div v-for="tool in availableTools" :key="tool.toolName" class="[&+&]:mt-1">
          <button
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-0 py-1 text-left text-inherit"
            type="button"
            @click="toggleTool(tool.toolName)"
          >
            <code
              data-testid="tool-name"
              class="rounded-[4px] bg-subtle px-1.5 py-0.5 font-['JetBrains_Mono',_monospace] text-[12px] break-all text-secondary"
              >{{ tool.toolName }}</code
            >
            <span v-if="tool.description" class="material-symbols-outlined text-[18px] text-dim" aria-hidden="true">{{
              expandedTools.has(tool.toolName) ? "expand_less" : "expand_more"
            }}</span>
          </button>
          <div v-if="expandedTools.has(tool.toolName)" class="mb-1.5 mt-0.5 whitespace-pre-wrap text-[12px] text-muted">
            {{ tool.description }}
          </div>
        </div>
      </div>

      <!-- Tool call history -->
      <div class="border-b border-border px-3 py-2.5">
        <div class="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-dim">
          <span>Tool Call History</span>
          <button
            class="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-border bg-subtle px-2 py-0.5 text-[10px] font-semibold normal-case tracking-[0.02em] text-muted enabled:hover:bg-selected-hover enabled:hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="toolCalls.length === 0"
            :title="historyCopied ? 'Copied!' : 'Copy all call history'"
            :aria-label="historyCopied ? 'Copied!' : 'Copy all call history'"
            @click="copyHistory"
          >
            <span class="material-symbols-outlined text-[14px] transition-[color,background] duration-150 ease-[ease]" aria-hidden="true">{{
              historyCopied ? "check" : "content_copy"
            }}</span>
            {{ historyCopied ? "Copied" : "Copy all" }}
          </button>
        </div>
        <div v-if="guiOnlyHistory" data-testid="gui-only-note" class="mb-1.5 text-[11px] leading-[1.35] text-dim">
          This agent reports no hooks, so the list holds its GUI tool calls only — not its shell commands or file edits.
        </div>
        <div v-if="toolCalls.length === 0" class="text-[12px] text-dim">{{ guiOnlyHistory ? "No GUI tool calls yet." : "No tool calls yet." }}</div>
        <div v-for="(call, i) in toolCalls" :key="callKey(call, i)" data-testid="tool-call" class="mt-1.5 rounded-md border border-border bg-deep px-2 py-1.5">
          <button
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-0 py-1 text-left text-inherit"
            type="button"
            @click="toggleCall(callKey(call, i))"
          >
            <code class="rounded-[4px] bg-subtle px-1.5 py-0.5 font-['JetBrains_Mono',_monospace] text-[12px] break-all text-secondary">{{
              call.toolName
            }}</code>
            <span class="flex shrink-0 items-center gap-2">
              <span
                v-if="call.status === 'running'"
                data-testid="badge-running"
                class="rounded-full bg-[var(--warn-bg-subtle)] px-1.5 py-px text-[10px] text-warn"
                >running…</span
              >
              <span v-else-if="call.status === 'failed'" data-testid="badge-failed" class="rounded-full bg-[var(--err-bg)] px-1.5 py-px text-[10px] text-err"
                >failed</span
              >
              <span v-else data-testid="badge-done" class="rounded-full bg-[var(--ok-bg-subtle)] px-1.5 py-px text-[10px] text-ok">{{
                call.durationMs != null ? `${call.durationMs} ms` : "done"
              }}</span>
              <span class="text-[11px] tabular-nums text-dim">{{ formatTime(call.at) }}</span>
            </span>
          </button>
          <div v-if="expandedCalls.has(callKey(call, i))" class="mt-1.5">
            <div class="mb-0.5 mt-1.5 text-[10px] uppercase tracking-[0.04em] text-dim">arguments</div>
            <pre
              class="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[4px] border border-border bg-deep px-2 py-1.5 font-['JetBrains_Mono',_monospace] text-[11.5px] [word-break:break-word]"
              >{{ formatValue(call.toolInput) }}</pre>
            <template v-if="call.status === 'completed' || call.status === 'failed'">
              <div class="mb-0.5 mt-1.5 text-[10px] uppercase tracking-[0.04em] text-dim">
                {{ call.status === "failed" ? "error" : "result" }}
              </div>
              <pre
                class="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[4px] border bg-deep px-2 py-1.5 font-['JetBrains_Mono',_monospace] text-[11.5px] [word-break:break-word]"
                :class="call.status === 'failed' ? 'border-[var(--err-bg)] text-err' : 'border-[var(--ok-border)]'"
                >{{ formatValue(call.toolOutput) || "(no output)" }}</pre>
            </template>
            <div v-else class="text-[12px] italic text-dim">Waiting for result…</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
