// GET /api/remote-hosts (#3506): the configured remote hosts, each probed, plus the entries that
// were not loaded and why. GET /api/remote-hosts/<id>/dirs: that host's saved directories.
// GET /api/remote-hosts/ids: the configured ids alone, unprobed.
//
// `remoteHosts` is read from config.json here rather than being an AppConfig key. That keeps it out
// of POST /api/config, so no page can add a host to forward to, and out of the sanitize-and-save
// round trip, so an entry this build refuses is left in the file as written instead of erased.
// config-routes carries keys it does not know back on every save.
import type { Express } from "express";
import { existsSync } from "node:fs";
import { isRecord } from "../../../common/isRecord.js";
import { parseRemoteHostDirs, REMOTE_HOST_IDS_ROUTE, type RemoteHostSummary, type RemoteHostsResponse } from "../../../common/remoteHosts.js";
import { readJsonFile } from "../../infra/fs/read-text-file.js";
import { parseRemoteHosts, type RemoteHost, type RemoteHostsConfig } from "./remoteHostsConfig.js";
import { remoteHostState } from "./remoteHostState.js";

const PROBE_TIMEOUT_MS = 3000;

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
