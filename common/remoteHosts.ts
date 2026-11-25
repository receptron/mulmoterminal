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
