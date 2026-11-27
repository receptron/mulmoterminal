// Remote hosts (#3506): other MulmoTerminal servers this one forwards to, each reached through a
// user-run `ssh -L`. Shared because the UI builds the `/remote/<id>/…` paths the server routes.

import { isRecord } from "./isRecord.js";
import { isUnknownArray } from "./isUnknownArray.js";

/** It sits unescaped in a URL path segment, so it is limited to what needs no escaping. */
export const REMOTE_HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const isRemoteHostId = (value: unknown): value is string => typeof value === "string" && REMOTE_HOST_ID_RE.test(value);

export const REMOTE_PATH_PREFIX = "/remote/";

export type RemoteHostState = "reachable" | "unreachable" | "version-mismatch";

const REMOTE_HOST_STATES: readonly RemoteHostState[] = ["reachable", "unreachable", "version-mismatch"];

const isRemoteHostState = (value: unknown): value is RemoteHostState => REMOTE_HOST_STATES.some((state) => state === value);

/** A row of GET /api/remote-hosts. The URL is not sent: the browser never talks to it. */
export interface RemoteHostSummary {
  id: string;
  label: string;
  state: RemoteHostState;
  /** The remote's version when it answered, else null. */
  version: string | null;
}

/** A config entry that was not loaded, and why, so a typo is not indistinguishable from no entry. */
export interface RemoteHostRejection {
  index: number;
  reason: string;
}

export interface RemoteHostsResponse {
  hosts: RemoteHostSummary[];
  rejected: RemoteHostRejection[];
}

const isRemoteHostSummary = (value: unknown): value is RemoteHostSummary =>
  isRecord(value) &&
  isRemoteHostId(value.id) &&
  typeof value.label === "string" &&
  isRemoteHostState(value.state) &&
  (value.version === null || typeof value.version === "string");

const isRemoteHostRejection = (value: unknown): value is RemoteHostRejection =>
  isRecord(value) && typeof value.index === "number" && typeof value.reason === "string";

export function parseRemoteHostsResponse(body: unknown): RemoteHostsResponse {
  if (!isRecord(body)) return { hosts: [], rejected: [] };
  return {
    hosts: isUnknownArray(body.hosts) ? body.hosts.filter(isRemoteHostSummary) : [],
    rejected: isUnknownArray(body.rejected) ? body.rejected.filter(isRemoteHostRejection) : [],
  };
}

/**
 * `/remote/<id>/<rest>` split into the host and the path to send it, or null for any other path.
 * Exact: the id must be a valid one and must be followed by a `/`, so `/remote/x` and `/remotex/…`
 * are not remote paths — a tolerant match here would swallow paths another handler owns.
 */
export function remotePathOf(pathname: string): { id: string; rest: string } | null {
  if (!pathname.startsWith(REMOTE_PATH_PREFIX)) return null;
  const afterPrefix = pathname.slice(REMOTE_PATH_PREFIX.length);
  const slash = afterPrefix.indexOf("/");
  if (slash < 0) return null;
  const id = afterPrefix.slice(0, slash);
  return isRemoteHostId(id) ? { id, rest: afterPrefix.slice(slash) } : null;
}

/** The inverse of remotePathOf: `path` (starting with `/`) as reached through host `id`. */
export const remotePath = (id: string, path: string): string => `${REMOTE_PATH_PREFIX}${id}${path}`;

/** GET /api/remote-hosts/<id>/dirs: where the launch form may start a terminal on that host. */
export const remoteHostDirsRoute = (id: string): string => `/api/remote-hosts/${id}/dirs`;

export interface RemoteDirPreset {
  label: string;
  path: string;
}

/** The remote's default workspace and its saved directories, and nothing else from its config. */
export interface RemoteHostDirs {
  cwd: string | null;
  presets: RemoteDirPreset[];
}

export const REMOTE_DIR_PRESETS_MAX = 200;

const isAbsolutePosixPath = (value: unknown): value is string => typeof value === "string" && value.startsWith("/");

const isRemoteDirPreset = (value: unknown): value is RemoteDirPreset => isRecord(value) && typeof value.label === "string" && isAbsolutePosixPath(value.path);

// Read from the remote's GET /api/config on the server, and again from the gateway's answer in the
// browser. Fields are copied, not passed through, so nothing else in that config leaves the server.
export function parseRemoteHostDirs(cwd: unknown, presets: unknown): RemoteHostDirs {
  const listed = isUnknownArray(presets) ? presets.filter(isRemoteDirPreset).slice(0, REMOTE_DIR_PRESETS_MAX) : [];
  return {
    cwd: isAbsolutePosixPath(cwd) ? cwd : null,
    presets: listed.map(({ label, path }) => ({ label, path })),
  };
}

/** The gateway's own answer, read back in the browser. */
export const parseRemoteHostDirsResponse = (body: unknown): RemoteHostDirs =>
  isRecord(body) ? parseRemoteHostDirs(body.cwd, body.presets) : { cwd: null, presets: [] };

/** GET: the configured host ids alone, read from config.json with no probe, so asking costs nothing. */
export const REMOTE_HOST_IDS_ROUTE = "/api/remote-hosts/ids";

export const parseRemoteHostIds = (body: unknown): string[] => (isRecord(body) && isUnknownArray(body.ids) ? body.ids.filter(isRemoteHostId) : []);

/** The Mac's channel for the remote hosts' session rows (#3506 phase 2). Separate from `sessions`
 *  on purpose: every subscriber of that one keys rows by bare id, and some act on the row's cwd on
 *  this machine, so a remote row there would be read as a local session. */
export const REMOTE_SESSIONS_CHANNEL = "remote-sessions";

/** A remote's `sessions` message, copied field by field: only the fields it is known to carry. */
export interface RemoteSessionRow {
  id: string;
  working: boolean;
  waiting: boolean;
  event: string | null;
  cwd?: string | null;
  failed?: boolean;
  lastPrompt?: string | null;
  aiTitle?: string | null;
  lastResponse?: string | null;
  memo?: string | null;
}

/** A row from `host`, or the relay saying that host's rows must be read again (it (re)connected or dropped). */
export type RemoteSessionRowMessage = { host: string; row: RemoteSessionRow };
export type RemoteSessionsMessage = RemoteSessionRowMessage | { host: string; resync: true };

/** The Mac's channel for a remote host's "a prompt was just submitted" (common/promptChannel.ts), so a
 *  remote cell's Prompts pane keeps up as a local one does. Separate from `prompt-submitted` for the
 *  reason above: its listeners take a bare id to be this machine's session. */
export const REMOTE_PROMPT_SUBMITTED_CHANNEL = "remote-prompt-submitted";

export interface RemotePromptSubmitted {
  host: string;
  sessionId: string;
}

export const parseRemotePromptSubmitted = (data: unknown): RemotePromptSubmitted | null =>
  isRecord(data) && isRemoteHostId(data.host) && typeof data.sessionId === "string" && data.sessionId !== ""
    ? { host: data.host, sessionId: data.sessionId }
    : null;

/** A remote session's own channels the relay follows on demand (#3506): the kinds a browser may ask
 *  for, each carrying one session's live items. */
export const REMOTE_SESSION_CHANNEL_KINDS = ["toolcalls", "session"] as const;
export type RemoteSessionChannelKind = (typeof REMOTE_SESSION_CHANNEL_KINDS)[number];

const REMOTE_CHANNEL_PREFIX = "remote:";

/** The Mac's channel for `kind` of a remote session: a browser subscribing to it is what makes the
 *  relay follow `<kind>:<id>` on that host, and what it hears is that channel's messages, unchanged. */
export const remoteSessionChannel = (host: string, kind: RemoteSessionChannelKind, id: string): string => `${REMOTE_CHANNEL_PREFIX}${host}:${kind}:${id}`;

/** The host and the remote's own channel a Mac channel names, or null for any other name. The id is
 *  the caller's to check, and the channel is rebuilt from the parts, never taken from the room. */
export function parseRemoteSessionChannel(room: string, isValidId: (id: string) => boolean): { host: string; channel: string } | null {
  if (!room.startsWith(REMOTE_CHANNEL_PREFIX)) return null;
  const [host, kind, id, ...rest] = room.slice(REMOTE_CHANNEL_PREFIX.length).split(":");
  const known = REMOTE_SESSION_CHANNEL_KINDS.find((candidate) => candidate === kind);
  if (rest.length > 0 || !isRemoteHostId(host) || known === undefined || id === undefined || !isValidId(id)) return null;
  return { host, channel: `${known}:${id}` };
}

/** The one key a client map uses for a remote session: ids are unique per host, not across hosts. */
export const remoteSessionKey = (host: string, id: string): string => `${host}/${id}`;

const OPTIONAL_TEXT_FIELDS = ["cwd", "lastPrompt", "aiTitle", "lastResponse", "memo"] as const;

const isNullableText = (value: unknown): value is string | null => value === null || typeof value === "string";

function optionalTextOf(body: Record<string, unknown>): Partial<Record<(typeof OPTIONAL_TEXT_FIELDS)[number], string | null>> {
  const present = OPTIONAL_TEXT_FIELDS.filter((field) => isNullableText(body[field]));
  return Object.fromEntries(present.map((field) => [field, body[field]]));
}

/** The row in a `sessions` message, or null when it is not one. `isValidId` is the caller's. */
export function remoteSessionRowOf(body: unknown, isValidId: (id: string) => boolean): RemoteSessionRow | null {
  if (!isRecord(body) || typeof body.id !== "string" || !isValidId(body.id)) return null;
  return {
    id: body.id,
    working: body.working === true,
    waiting: body.waiting === true,
    event: typeof body.event === "string" ? body.event : null,
    ...(typeof body.failed === "boolean" ? { failed: body.failed } : {}),
    ...optionalTextOf(body),
  };
}

/** What a browser reads off REMOTE_SESSIONS_CHANNEL, or null for anything else. The server built it,
 *  so the id is only checked to be a non-empty string here. */
export function parseRemoteSessionsMessage(data: unknown): RemoteSessionsMessage | null {
  if (!isRecord(data) || !isRemoteHostId(data.host)) return null;
  if (data.resync === true) return { host: data.host, resync: true };
  const row = remoteSessionRowOf(data.row, (id) => id !== "");
  return row ? { host: data.host, row } : null;
}

/** GET on the Mac: the current activity of a remote host's sessions, as the remote answers it. */
export const remoteHostActivityRoute = (id: string): string => `/api/remote-hosts/${id}/activity`;

export type RemoteActivity = Record<string, { working: boolean; waiting: boolean; event: string | null }>;

/** The remote's `/api/activity` answer, cut down to the asked ids and the three fields. */
export function remoteActivityOf(body: unknown, ids: readonly string[]): RemoteActivity {
  const answer = isRecord(body) ? body : {};
  return Object.fromEntries(
    ids.map((id) => {
      const entry = answer[id];
      const row = isRecord(entry) ? entry : {};
      return [id, { working: row.working === true, waiting: row.waiting === true, event: typeof row.event === "string" ? row.event : null }];
    }),
  );
}

/** GET on the Mac: one remote session's detail, as the remote's /api/session/:id answers it, cut down. */
export const remoteHostSessionRoute = (host: string, sessionId: string): string => `/api/remote-hosts/${host}/session/${sessionId}`;

// What a remote cell reads off its session's detail: the activity, the titles and prompt the roster
// shows, the memo, and the token and context badges. Left out on purpose: `peerName` (what other
// sessions ON THE REMOTE call this one) and `collection` (a store on the remote's disk).
const DETAIL_TEXT_FIELDS = ["event", "lastPrompt", "lastResponse", "aiTitle", "customTitle", "agentTitle", "agentTitleKind", "memo", "workPhase"] as const;
const DETAIL_FLAG_FIELDS = ["working", "waiting"] as const;
const DETAIL_OBJECT_FIELDS = ["usage", "context"] as const;

/** The allowed fields of a remote's session detail, each only when it has the type the cell reads. */
export function remoteSessionDetailOf(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  const detail: Record<string, unknown> = {};
  const keep = (fields: readonly string[], allowed: (value: unknown) => boolean) =>
    fields.filter((field) => allowed(body[field])).forEach((field) => (detail[field] = body[field]));
  keep(DETAIL_TEXT_FIELDS, isNullableText);
  keep(DETAIL_FLAG_FIELDS, (value) => typeof value === "boolean");
  keep(DETAIL_OBJECT_FIELDS, isRecord);
  return detail;
}
