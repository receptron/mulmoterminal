// The GUI panel's two per-session stores: the tool RESULTS a plugin rendered, and the
// tool-CALL history every hook records. Both are disk-backed so the panel replays after a
// reboot. Extracted from index.ts (#548) with two things injected rather than imported:
//
// - `publish`, because pub/sub only exists once the HTTP server does. It arrives as a
//   closure, so it stays correct however late that happens.
// - `root`, so a test writes to a temp directory instead of the developer's own
//   ~/.mulmoterminal — the readers' equivalent of that binding is why registry.ts still
//   has no tests.
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { messageOf } from "../errors.js";
import type { ToolCall, ToolResult } from "./types.js";

export interface ToolStoreDeps {
  /** Fan a change out to the panel; a no-op before pub/sub exists. */
  publish: (channel: string, data: unknown) => void;
  /** Where the JSON files live. Defaults to ~/.mulmoterminal. */
  root?: string;
}

// A per-session list store mirrored to disk so it survives a server reboot — one
// JSON file per session under <workspace>/<dirName>/<sessionId>.json
// (<workspace> = CLAUDE_CWD). The in-memory Map is the working copy; the file is
// rewritten on each change and lazy-loaded on first access. Session ids are
// validated UUIDs (SESSION_ID_RE), so they're safe to use as filenames.
export function createSessionStore<T>(dirName: string, root: string = MULMOTERMINAL_HOME) {
  const dir = path.join(root, dirName);
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  const map = new Map<string, T[]>(); // id -> list (the working copy; mutate in place)
  const loading = new Map<string, Promise<T[]>>(); // id -> Promise<list>, dedupes concurrent loads

  // Lazily load a session's list from disk, then keep using the in-memory copy.
  function get(sessionId: string): Promise<T[]> {
    const cached = map.get(sessionId);
    if (cached) return Promise.resolve(cached);
    const inflight = loading.get(sessionId);
    if (inflight) return inflight;
    const p = (async () => {
      let list: T[] = [];
      if (SESSION_ID_RE.test(sessionId)) {
        try {
          const parsed = JSON.parse(await fs.readFile(fileFor(sessionId), "utf8"));
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          // No file yet (or unreadable) => start empty.
        }
      }
      map.set(sessionId, list);
      loading.delete(sessionId);
      return list;
    })();
    loading.set(sessionId, p);
    return p;
  }

  // Persist a session's list (best-effort, fire-and-forget).
  async function save(sessionId: string) {
    if (!SESSION_ID_RE.test(sessionId)) return;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fileFor(sessionId), JSON.stringify(map.get(sessionId) || []));
    } catch (e) {
      console.error(`[${dirName}] failed to persist ${sessionId}: ${messageOf(e)}`);
    }
  }

  return { get, save };
}

export const toolCallsChannel = (id: string) => `toolcalls:${id}`;

// Stored tool outputs are capped so one verbose tool can't bloat the on-disk history (and
// the pane). The raw output still reaches the LLM via the terminal; this is only the copy.
const TOOL_OUTPUT_CAP = 20_000;

export function capToolOutput(output: unknown): unknown {
  if (typeof output === "string" && output.length > TOOL_OUTPUT_CAP) {
    return output.slice(0, TOOL_OUTPUT_CAP) + `\n… (truncated ${output.length - TOOL_OUTPUT_CAP} chars)`;
  }
  return output;
}

/** The panel's stores, bound to one pub/sub and one directory root. */
export function createToolStores({ publish, root = MULMOTERMINAL_HOME }: ToolStoreDeps) {
  // GUI toolResults per session, persisted under ~/.mulmoterminal/toolresults so
  // the panel replays the rendered views even after a server reboot. (Chat +
  // message history live in the terminal and Claude's .jsonl; this is the GUI-side
  // store.) Each entry is an array of toolResults, capped to the most recent N.
  const toolResultsStore = createSessionStore<ToolResult>("toolresults", root);
  const GUI_HISTORY_LIMIT = 50;

  // Upsert a toolResult into a session's list, deduped by uuid — a re-emitted result
  // (e.g. a form whose viewState changed after the user submitted) updates in place.
  // Mirrors MulmoClaude's applyToolResultToSession.
  async function storeToolResult(sessionId: string, result: ToolResult) {
    const list = await toolResultsStore.get(sessionId);
    const idx = list.findIndex((r) => r.uuid === result.uuid);
    if (idx >= 0) {
      list[idx] = result;
    } else {
      list.push(result);
      if (list.length > GUI_HISTORY_LIMIT) list.splice(0, list.length - GUI_HISTORY_LIMIT);
    }
    toolResultsStore.save(sessionId);
  }

  // Per-session tool-call history, fed by Claude's PreToolUse/PostToolUse hooks so
  // it captures EVERY tool call — built-ins (Bash, Read, …), the user's MCP tools,
  // AND our GUI plugin tools — not just the GUI ones the broker sees. Published on a
  // per-session channel the tools pane subscribes to. (The broker's toolResults
  // store above is separate; it only drives rendering of GUI views.)
  //
  // Persisted under ~/.mulmoterminal/toolcalls via the same disk-backed store as
  // the toolResults, so the history survives a server reboot.
  const toolCallsStore = createSessionStore<ToolCall>("toolcalls", root);
  const TOOLCALLS_LIMIT = 200;
  // PreToolUse: a tool started. Append a "running" entry (deduped by tool_use_id).
  async function recordToolCallStart(sessionId: string, { toolUseId, toolName, toolInput }: { toolUseId?: string; toolName?: string; toolInput?: unknown }) {
    const list = await toolCallsStore.get(sessionId);
    if (toolUseId && list.some((c) => c.toolUseId === toolUseId)) return;
    const call = { toolUseId, toolName, toolInput, status: "running", at: Date.now() };
    list.push(call);
    if (list.length > TOOLCALLS_LIMIT) list.splice(0, list.length - TOOLCALLS_LIMIT);
    publish(toolCallsChannel(sessionId), call);
    toolCallsStore.save(sessionId);
  }

  // PostToolUse (status "completed") or PostToolUseFailure (status "failed"):
  // complete the matching entry by tool_use_id (or add one if we never saw the
  // start). A failed tool fires PostToolUseFailure, NOT PostToolUse, so both route
  // here — otherwise the entry would be stuck on "running".
  async function recordToolCallEnd(
    sessionId: string,
    {
      toolUseId,
      toolName,
      toolInput,
      toolOutput,
      durationMs,
      status,
    }: {
      toolUseId?: string;
      toolName?: string;
      toolInput?: unknown;
      toolOutput?: unknown;
      durationMs?: number;
      status: string;
    },
  ) {
    const list = await toolCallsStore.get(sessionId);
    const output = capToolOutput(toolOutput);
    let call = toolUseId ? list.find((c) => c.toolUseId === toolUseId) : undefined;
    if (call) {
      call.status = status;
      call.toolOutput = output;
      call.durationMs = durationMs;
    } else {
      call = { toolUseId, toolName, toolInput, toolOutput: output, status, at: Date.now(), durationMs };
      list.push(call);
      if (list.length > TOOLCALLS_LIMIT) list.splice(0, list.length - TOOLCALLS_LIMIT);
    }
    publish(toolCallsChannel(sessionId), call);
    toolCallsStore.save(sessionId);
  }

  return { toolResultsStore, toolCallsStore, storeToolResult, recordToolCallStart, recordToolCallEnd };
}
