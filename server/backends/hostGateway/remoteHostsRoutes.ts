// GET /api/remote-hosts (#3506): the configured remote hosts, each probed, plus the entries that
// were not loaded and why. GET /api/remote-hosts/<id>/dirs: that host's saved directories.
// GET /api/remote-hosts/ids: the configured ids alone, unprobed. GET /api/remote-hosts/<id>/activity:
// that host's sessions' working / waiting, the seed for the rows the session relay pushes.
// GET /api/remote-hosts/<id>/session/<sid>: that session's badges, titles and memo, cut down.
//
// `remoteHosts` is read from config.json here rather than being an AppConfig key. That keeps it out
// of POST /api/config, so no page can add a host to forward to, and out of the sanitize-and-save
// round trip, so an entry this build refuses is left in the file as written instead of erased.
// config-routes carries keys it does not know back on every save.
import type { Express } from "express";
import { existsSync } from "node:fs";
import { isRecord } from "../../../common/isRecord.js";
import {
  parseRemoteHostDirs,
  REMOTE_HOST_IDS_ROUTE,
  remoteActivityOf,
  remoteHostActivityRoute,
  remoteHostSessionRoute,
  remoteSessionDetailOf,
  type RemoteHostSummary,
  type RemoteHostsResponse,
} from "../../../common/remoteHosts.js";
import { SESSION_ID_RE } from "../../config/env.js";
import { parseActivityIds } from "../../session/list/session-list.js";
import { asTerminalAgent } from "../../../common/sessionAgent.js";
import { readJsonFile } from "../../infra/fs/read-text-file.js";
import { parseRemoteHosts, type RemoteHost, type RemoteHostsConfig } from "./remoteHostsConfig.js";
import { remoteHostState } from "./remoteHostState.js";

const PROBE_TIMEOUT_MS = 3000;
// The remote's own /api/activity caps a request at this many ids too.
const REMOTE_ACTIVITY_IDS_LIMIT = 200;

export function loadRemoteHosts(configFile: string): RemoteHostsConfig {
  if (!existsSync(configFile)) return { hosts: [], rejected: [] };
  try {
    const raw = readJsonFile(configFile);
    return parseRemoteHosts(isRecord(raw) ? raw.remoteHosts : undefined);
  } catch (err) {
    return { hosts: [], rejected: [{ index: -1, reason: `cannot read ${configFile}: ${String(err)}` }] };
  }
}

export type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>;

const fetchJson: FetchJson = async (url, signal) => {
  const res = await fetch(url, { signal });
  return res.ok ? res.json() : null;
};

async function fetchWithin(fetchImpl: FetchJson, url: string): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetchImpl(url, abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(host: RemoteHost, localVersion: string, fetchImpl: FetchJson): Promise<RemoteHostSummary> {
  try {
    const body = await fetchWithin(fetchImpl, `${host.origin}/api/update-status`);
    return { id: host.id, label: host.label, ...remoteHostState(localVersion, body) };
  } catch {
    return { id: host.id, label: host.label, state: "unreachable", version: null };
  }
}

/** Whether `host` answers with this server's major version: what the session relay asks before connecting. */
export const isUsableHost = async (host: RemoteHost, localVersion: string, fetchImpl: FetchJson = fetchJson): Promise<boolean> =>
  (await probe(host, localVersion, fetchImpl)).state === "reachable";

// The remote's whole config is read, and only its directories are answered: the browser never sees
// the rest, and never talks to the remote's /api itself.
async function readRemoteDirs(host: RemoteHost, fetchImpl: FetchJson): Promise<unknown> {
  const url = `${host.origin}/api/config`;
  try {
    const body = await fetchWithin(fetchImpl, url);
    return isRecord(body) ? parseRemoteHostDirs(body.cwd, body.cwdPresets) : { error: `${host.label} answered ${url} without a config` };
  } catch (err) {
    return { error: `${host.label} did not answer ${url}: ${String(err)}` };
  }
}

// Only ids the remote can hold go into its URL; the answer is cut to those ids and three fields.
async function readRemoteActivity(host: RemoteHost, ids: readonly string[], fetchImpl: FetchJson): Promise<unknown> {
  if (ids.length === 0) return {};
  const url = `${host.origin}/api/activity?ids=${ids.map(encodeURIComponent).join(",")}`;
  try {
    const body = await fetchWithin(fetchImpl, url);
    return isRecord(body) ? remoteActivityOf(body, ids) : { error: `${host.label} answered ${url} without activity` };
  } catch (err) {
    return { error: `${host.label} did not answer ${url}: ${String(err)}` };
  }
}

// The agent names the log the remote reads the badges from, and the cwd is the REMOTE's directory,
// so both go along. Anything else in the query is not forwarded.
const REMOTE_CWD_MAX = 4096;
function detailQuery(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams({ agent: asTerminalAgent(query.agent) });
  const { cwd } = query;
  if (typeof cwd === "string" && cwd.startsWith("/") && cwd.length <= REMOTE_CWD_MAX) params.set("cwd", cwd);
  return params;
}

async function readRemoteSessionDetail(host: RemoteHost, sessionId: string, params: URLSearchParams, fetchImpl: FetchJson): Promise<unknown> {
  const url = `${host.origin}/api/session/${sessionId}?${params}`;
  try {
    const body = await fetchWithin(fetchImpl, url);
    return isRecord(body) ? remoteSessionDetailOf(body) : { error: `${host.label} answered ${url} without a session` };
  } catch (err) {
    return { error: `${host.label} did not answer ${url}: ${String(err)}` };
  }
}

export interface RemoteHostsRouteDeps {
  configFile: string;
  localVersion: () => string;
  fetchJson?: FetchJson;
}

export function mountRemoteHostsRoutes(app: Express, deps: RemoteHostsRouteDeps): void {
  app.get("/api/remote-hosts", async (_req, res) => {
    const { hosts, rejected } = loadRemoteHosts(deps.configFile);
    const summaries = await Promise.all(hosts.map((host) => probe(host, deps.localVersion(), deps.fetchJson ?? fetchJson)));
    const body: RemoteHostsResponse = { hosts: summaries, rejected };
    res.json(body);
  });

  app.get(remoteHostActivityRoute(":id"), async (req, res) => {
    const host = loadRemoteHosts(deps.configFile).hosts.find((candidate) => candidate.id === req.params.id);
    if (!host) {
      res.status(404).json({ error: `no remote host "${req.params.id}" is configured` });
      return;
    }
    const ids = parseActivityIds(req.query.ids, (id) => SESSION_ID_RE.test(id), REMOTE_ACTIVITY_IDS_LIMIT);
    const answer = await readRemoteActivity(host, ids, deps.fetchJson ?? fetchJson);
    res.status(isRecord(answer) && "error" in answer ? 502 : 200).json(answer);
  });

  app.get(remoteHostSessionRoute(":id", ":sid"), async (req, res) => {
    const host = loadRemoteHosts(deps.configFile).hosts.find((candidate) => candidate.id === req.params.id);
    if (!host) {
      res.status(404).json({ error: `no remote host "${req.params.id}" is configured` });
      return;
    }
    const { sid } = req.params;
    if (typeof sid !== "string" || !SESSION_ID_RE.test(sid)) {
      res.status(400).json({ error: "not a session id" });
      return;
    }
    const answer = await readRemoteSessionDetail(host, sid, detailQuery(req.query), deps.fetchJson ?? fetchJson);
    res.status(isRecord(answer) && "error" in answer ? 502 : 200).json(answer);
  });

  app.get(REMOTE_HOST_IDS_ROUTE, (_req, res) => {
    res.json({ ids: loadRemoteHosts(deps.configFile).hosts.map((host) => host.id) });
  });

  app.get("/api/remote-hosts/:id/dirs", async (req, res) => {
    const host = loadRemoteHosts(deps.configFile).hosts.find((candidate) => candidate.id === req.params.id);
    if (!host) {
      res.status(404).json({ error: `no remote host "${req.params.id}" is configured` });
      return;
    }
    const answer = await readRemoteDirs(host, deps.fetchJson ?? fetchJson);
    res.status(isRecord(answer) && "error" in answer ? 502 : 200).json(answer);
  });
}
