// Shapes shared by the session layer: the live-PTY table, the sidebar rows those resolve
// into, and the per-session GUI records. Extracted from index.ts so the registry and the
// modules that read it can name them without importing the boot module (#548).
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import type { WorkerStatus } from "../../common/workerStatus.js";
import type { SessionAgent } from "../../common/sessionAgent.js";

export interface Activity {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  at?: number;
}

// A live PTY and its (possibly detached) browser socket.
export interface PtyEntry {
  term: IPty;
  ws: WebSocket | null;
  buffer: string;
  cwd: string; // the dir the PTY actually runs in (reported on reattach)
  // True when this session is the user's actively-viewed pane: the single-view open
  // session, or a focused/zoomed grid cell. Gates the attention flag — a socket being
  // attached is NOT enough (every on-screen grid cell has one), so `ws != null` can't
  // stand in for "the user is looking at THIS cell". Set at attach (by gui mode) and
  // updated by the client's `view` frame.
  active: boolean;
  // True when `term` is a tmux client (persistent): killing it only detaches, so reap
  // must kill the tmux session to actually end the program.
  tmux?: boolean;
  // A reattach replayed a delta tail, so the browser's screen is only as complete as that window
  // (see tmuxRedrawClient). Cleared by the first resize frame after the reattach — waiting for it
  // is the point, since that frame is where the client tells us the size it actually settled at.
  redrawPending?: boolean;
  // What is running in this PTY. Recorded at spawn because nothing else can recover it
  // later, and the phone needs it to offer input that suits the session (mulmoserver#84).
  agent: SessionAgent;
}

export interface KnownSession {
  createdAt: number;
  title: string;
}

// A GUI plugin result, deduped by uuid; the rest of the payload is opaque here.
export interface ToolResult {
  uuid: string;
  [key: string]: unknown;
}

// One entry in a session's tool-call history (Pre/PostToolUse hooks).
// The optional fields carry `| undefined` because the hook payload they are copied from
// may omit any of them, and a completed call assigns durationMs in place.
export interface ToolCall {
  toolUseId?: string | undefined;
  toolName?: string | undefined;
  toolInput?: unknown;
  toolOutput?: unknown;
  durationMs?: number | undefined;
  status: string;
  at: number;
}

// A sidebar session row (resolved from disk or a pending in-memory session).
export interface SessionMeta extends WorkerStatus {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
  /** The hook that set the current state (e.g. "Stop" | "Notification"), or null.
   *  Lets the client split `waiting` into "done, unreviewed" (Stop) vs "blocked on
   *  input" (Notification). */
  event: string | null;
}

// Recency rank for an on-disk .jsonl, before its contents are read.
export interface DiskStat {
  kind: "disk";
  id: string;
  file: string;
  mtime: number;
}

// An in-memory session not yet persisted to disk.
export interface PendingSession extends SessionMeta {
  kind: "pending";
}
