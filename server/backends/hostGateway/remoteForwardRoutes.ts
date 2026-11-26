// `/remote/<id>/api/…` (#3506): a route of common/remoteRoutes.ts, replayed to that host.
//
// This server's own gates (host guard, same-origin guard on writes) have already run when a request
// gets here, exactly as for a local `/api/*` call. The replay carries the REMOTE's own origin, so a
// page here has the power of the remote's own page and no more; nothing else of the browser's
// request goes along — no cookie, and only the parameters the table names.
//
// Only JSON comes back. Anything else would be the remote's bytes served under this origin, which is
// the byte proxy's job and needs the remote's CSP kept intact.
import type { Express, Request, Response } from "express";
import { isRecord } from "../../../common/isRecord.js";
import { remotePathOf } from "../../../common/remoteHosts.js";
import type { RemoteRoute } from "../../../common/remoteRoutes.js";
import { readChunks } from "../../infra/http/readChunks.js";
import { decideForward } from "./remoteForward.js";
import type { RemoteHost } from "./remoteHostsConfig.js";

export const FORWARD_TIMEOUT_MS = 15_000;
export const FORWARD_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const REMOTE_API = /^\/remote\/[^/]+\/api\//;

export interface RemoteForwardDeps {
  /** Read per request, so an edit to config.json applies without a restart. */
  remoteHosts: () => readonly RemoteHost[];
  routes?: Readonly<Record<string, RemoteRoute>>;
  fetchImpl?: typeof fetch;
}

type Answer = { status: number; json: string } | { status: number; error: string };

// The body is read only up to the cap: a remote answering without end must not fill this server.
async function readCapped(res: globalThis.Response): Promise<string | null> {
  if (!res.body) return "";
  const chunks = await readChunks(res.body.getReader(), FORWARD_RESPONSE_MAX_BYTES);
  return chunks === null ? null : Buffer.concat(chunks).toString("utf8");
}

function requestInit(req: Request, route: RemoteRoute, host: RemoteHost, signal: AbortSignal): RequestInit {
  const hasBody = route.access === "write" && isRecord(req.body);
  const headers: Record<string, string> = { origin: host.origin, accept: "application/json" };
  if (hasBody) headers["content-type"] = "application/json";
  const init: RequestInit = { method: req.method, headers, signal, redirect: "manual" };
  if (hasBody) init.body = JSON.stringify(req.body);
  return init;
}

async function replay(req: Request, host: RemoteHost, forward: { route: RemoteRoute; path: string }, fetchImpl: typeof fetch): Promise<Answer> {
  const url = `${host.origin}${forward.path}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, requestInit(req, forward.route, host, abort.signal));
    if (res.status >= 300 && res.status < 400) return { status: 502, error: `${host.label} redirected ${url}` };
    if (!(res.headers.get("content-type") ?? "").includes("application/json"))
      return { status: 502, error: `${host.label} answered ${url} with something other than JSON` };
    const json = await readCapped(res);
    return json === null
      ? { status: 502, error: `${host.label} answered ${url} with more than ${FORWARD_RESPONSE_MAX_BYTES} bytes` }
      : { status: res.status, json };
  } catch (err) {
    return { status: 502, error: `${host.label} did not answer ${url}: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function send(res: Response, answer: Answer): void {
  res.status(answer.status).set({ "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
  res.send("json" in answer ? answer.json : JSON.stringify({ error: answer.error }));
}

export function mountRemoteForwardRoutes(app: Express, deps: RemoteForwardDeps): void {
  const forward = async (req: Request, res: Response): Promise<void> => {
    const remote = remotePathOf(req.path);
    const host = remote ? deps.remoteHosts().find((candidate) => candidate.id === remote.id) : undefined;
    if (!remote || !host) return send(res, { status: 404, error: `no remote host for ${req.path}` });
    const decision = decideForward(req.method, remote.rest, req.query, deps.routes);
    if (decision.kind === "refuse") return send(res, { status: decision.status, error: decision.reason });
    send(res, await replay(req, host, decision, deps.fetchImpl ?? fetch));
  };
  // The table's methods only, so no other verb reaches the handler at all.
  app.get(REMOTE_API, forward);
  app.post(REMOTE_API, forward);
  app.put(REMOTE_API, forward);
  app.delete(REMOTE_API, forward);
}
