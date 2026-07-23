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

// The file's mtime, or 0 when there is no readable file.
async function fileMtimeMs(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

// A per-session list store mirrored to disk so it survives a server reboot — one
// JSON file per session under <workspace>/<dirName>/<sessionId>.json
// (<workspace> = CLAUDE_CWD). The in-memory Map is the working copy; the file is
// rewritten on each change and lazy-loaded on first access. Session ids are
// validated UUIDs (SESSION_ID_RE), so they're safe to use as filenames.
//
// The file is shared with any other server rooted at the same MULMOTERMINAL_HOME. Only the
// server that spawned a session ever WRITES its file (the hook/broker URLs bake in the owning
// server's port), but a NON-owning server can READ it (a phone/browser attached to it opens
// that session's tool history). This instance OWNS any session it has ever saved: that map is
// the source of truth and is never re-read (its writes are fire-and-forget, so re-reading could
// clobber an in-place mutation not yet flushed). A session this instance has only READ is
// re-read when the file's mtime is newer than the copy it cached, so the non-owner picks up the
// owner's appends instead of holding a stale copy until it restarts. `statMtimeMs` is a
// parameter so a test can drive the mtime deterministically. (#705)
export function createSessionStore<T>(dirName: string, root: string = MULMOTERMINAL_HOME, statMtimeMs: (file: string) => Promise<number> = fileMtimeMs) {
  const dir = path.join(root, dirName);
  const fileFor = (id: string) => path.join(dir, `${id}.json`);
  const map = new Map<string, T[]>(); // id -> list (the working copy; mutate in place)
  const owned = new Set<string>(); // sessions this instance has written => authoritative, never re-read
  const loadedMtime = new Map<string, number>(); // id -> file mtime as of the last read (non-owned only)
  const loading = new Map<string, Promise<T[]>>(); // id -> Promise<list>, dedupes concurrent loads

  // Read a session's list off disk. Stat BEFORE reading so a write that races the read is
  // caught on the next get (a stale-newer mtime only costs one extra re-read; a stale-older one
  // could miss the update). Missing / corrupt / non-array file => empty.
  async function readFromDisk(sessionId: string): Promise<{ list: T[]; mtimeMs: number }> {
    if (!SESSION_ID_RE.test(sessionId)) return { list: [], mtimeMs: 0 };
    const file = fileFor(sessionId);
    const mtimeMs = await statMtimeMs(file);
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return { list: Array.isArray(parsed) ? parsed : [], mtimeMs };
    } catch {
      return { list: [], mtimeMs: 0 };
    }
  }

  function firstLoad(sessionId: string): Promise<T[]> {
    const inflight = loading.get(sessionId);
    if (inflight) return inflight;
    const p = (async () => {
      const { list, mtimeMs } = await readFromDisk(sessionId);
      map.set(sessionId, list);
      loadedMtime.set(sessionId, mtimeMs);
      loading.delete(sessionId);
      return list;
    })();
    loading.set(sessionId, p);
    return p;
  }

  // Return the cached list, or re-read it if another instance wrote the file since we cached it.
  async function maybeReload(sessionId: string, cached: T[]): Promise<T[]> {
    if (!SESSION_ID_RE.test(sessionId)) return cached; // an invalid id never had a file
    if ((await statMtimeMs(fileFor(sessionId))) <= (loadedMtime.get(sessionId) ?? 0)) return cached;
    const { list, mtimeMs } = await readFromDisk(sessionId);
    map.set(sessionId, list);
    loadedMtime.set(sessionId, mtimeMs);
    return list;
  }

  // Lazily load a session's list from disk; on later calls keep the in-memory copy. A session
  // this instance owns (has written) is always its cached working array; one it has only read is
  // re-read when a second instance that owns it has since appended to the file.
  function get(sessionId: string): Promise<T[]> {
    const cached = map.get(sessionId);
    if (!cached) return firstLoad(sessionId);
    if (owned.has(sessionId)) return Promise.resolve(cached);
    return maybeReload(sessionId, cached);
  }

  // Persist a session's list (best-effort, fire-and-forget). Writing marks the session owned by
  // this instance, so subsequent reads trust the in-memory working copy over the disk.
  async function save(sessionId: string) {
    if (!SESSION_ID_RE.test(sessionId)) return;
    owned.add(sessionId);
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
