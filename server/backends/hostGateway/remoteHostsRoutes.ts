// GET /api/remote-hosts (#3506): the configured remote hosts, each probed, plus the entries that
// were not loaded and why.
//
// `remoteHosts` is read from config.json here rather than being an AppConfig key. That keeps it out
// of POST /api/config, so no page can add a host to forward to, and out of the sanitize-and-save
// round trip, so an entry this build refuses is left in the file as written instead of erased.
// config-routes carries keys it does not know back on every save.
import type { Express } from "express";
import { existsSync } from "node:fs";
import { isRecord } from "../../../common/isRecord.js";
import type { RemoteHostSummary, RemoteHostsResponse } from "../../../common/remoteHosts.js";
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

// A redirect would leave the loopback origin the config was checked for, so it is not followed.
export const fetchJson: FetchJson = async (url, signal) => {
  const probeRes = await fetch(url, { signal, redirect: "error" });
  if (probeRes.ok) return probeRes.json();
  await probeRes.body?.cancel();
  return null;
};

async function probe(host: RemoteHost, localVersion: string, fetchImpl: FetchJson): Promise<RemoteHostSummary> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    const body = await fetchImpl(`${host.origin}/api/update-status`, abort.signal);
    return { id: host.id, label: host.label, ...remoteHostState(localVersion, body) };
  } catch {
    return { id: host.id, label: host.label, state: "unreachable", version: null };
  } finally {
    clearTimeout(timer);
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
}
