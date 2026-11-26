// `/remote/<id>/api/…` (#3506): a route of common/remoteRoutes.ts, replayed to that host.
//
// This server's own gates (host guard, same-origin guard on writes) have already run when a request
// gets here, exactly as for a local `/api/*` call. The replay carries the REMOTE's own origin, so a
// page here has the power of the remote's own page and no more; nothing else of the browser's
// request goes along — no cookie, and only the parameters the table names.
//
// A dropped file's bytes are the one raw body: its route is read before the JSON parser, as the
// local drop route is, so a dropped `.json` stays bytes.
//
// Only JSON comes back. Anything else would be the remote's bytes served under this origin, which is
// the byte proxy's job and needs the remote's CSP kept intact.
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { isRecord } from "../../../common/isRecord.js";
import { remotePathOf } from "../../../common/remoteHosts.js";
import type { RemoteRoute } from "../../../common/remoteRoutes.js";
import { MAX_DROP_BYTES } from "../../../common/dropUpload.js";
import { readChunks } from "../../infra/http/readChunks.js";
import { decideForward } from "./remoteForward.js";
import type { RemoteHost } from "./remoteHostsConfig.js";

export const FORWARD_TIMEOUT_MS = 15_000;
// A raw body is a file of up to MAX_DROP_BYTES, which the browser itself allows this long to send.
export const RAW_FORWARD_TIMEOUT_MS = 300_000;
// A slow route (a search, a whole index) is one the browser itself waits this long for.
export const SLOW_FORWARD_TIMEOUT_MS = 60_000;
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
  const headers: Record<string, string> = { origin: host.origin, accept: "application/json" };
  (route.headers ?? []).forEach((name) => {
    const value = req.get(name);
    if (value !== undefined) headers[name] = value;
  });
  const init: RequestInit = { method: req.method, headers, signal, redirect: "manual" };
  if (route.access !== "write") return init;
  if (route.body === "raw") {
    if (Buffer.isBuffer(req.body)) init.body = new Uint8Array(req.body);
  } else if (isRecord(req.body)) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }
  return init;
}

export function timeoutFor(route: RemoteRoute): number {
  if (route.body === "raw") return RAW_FORWARD_TIMEOUT_MS;
  return route.wait === "slow" ? SLOW_FORWARD_TIMEOUT_MS : FORWARD_TIMEOUT_MS;
}

async function replay(req: Request, res: Response, host: RemoteHost, forward: { route: RemoteRoute; path: string }, fetchImpl: typeof fetch): Promise<Answer> {
  const url = `${host.origin}${forward.path}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutFor(forward.route));
  // A browser that walked away (a search superseded by the next keystroke) stops the remote's work too.
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    const remoteRes = await fetchImpl(url, requestInit(req, forward.route, host, abort.signal));
    if (remoteRes.status >= 300 && remoteRes.status < 400) return { status: 502, error: `${host.label} redirected ${url}` };
    if (!(remoteRes.headers.get("content-type") ?? "").includes("application/json"))
      return { status: 502, error: `${host.label} answered ${url} with something other than JSON` };
    const json = await readCapped(remoteRes);
    return json === null
      ? { status: 502, error: `${host.label} answered ${url} with more than ${FORWARD_RESPONSE_MAX_BYTES} bytes` }
      : { status: remoteRes.status, json };
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

type Decided = { kind: "send"; answer: Answer } | { kind: "forward"; host: RemoteHost; route: RemoteRoute; path: string };

function decide(req: Request, deps: RemoteForwardDeps): Decided {
  const remote = remotePathOf(req.path);
  const host = remote ? deps.remoteHosts().find((candidate) => candidate.id === remote.id) : undefined;
  if (!remote || !host) return { kind: "send", answer: { status: 404, error: `no remote host for ${req.path}` } };
  const decision = decideForward(req.method, remote.rest, req.query, deps.routes);
  if (decision.kind === "refuse") return { kind: "send", answer: { status: decision.status, error: decision.reason } };
  return { kind: "forward", host, route: decision.route, path: decision.path };
}

async function answer(req: Request, res: Response, decided: Decided, deps: RemoteForwardDeps): Promise<void> {
  if (decided.kind === "send") return send(res, decided.answer);
  const replayed = await replay(req, res, decided.host, decided, deps.fetchImpl ?? fetch);
  if (!res.destroyed) send(res, replayed);
}

/** The routes with a JSON body or none. Mounted after the JSON parser. */
export function mountRemoteForwardRoutes(app: Express, deps: RemoteForwardDeps): void {
  const forward = (req: Request, res: Response): Promise<void> => answer(req, res, decide(req, deps), deps);
  // The table's methods only, so no other verb reaches the handler at all.
  app.get(REMOTE_API, forward);
  app.post(REMOTE_API, forward);
  app.put(REMOTE_API, forward);
  app.delete(REMOTE_API, forward);
}

/** The raw-body routes, read here and replayed; every other request passes on to the routes above.
 *  Mounted BEFORE the JSON parser, beside the local drop route. */
export function mountRemoteRawForwardRoutes(app: Express, deps: RemoteForwardDeps): void {
  const rawBody = express.raw({ type: () => true, limit: MAX_DROP_BYTES });
  app.post(REMOTE_API, (req: Request, res: Response, next: NextFunction) => {
    const decided = decide(req, deps);
    if (decided.kind !== "forward" || decided.route.body !== "raw") return next();
    rawBody(req, res, (err?: unknown) => {
      if (err) return send(res, { status: rawBodyStatus(err), error: `could not read the body for ${req.path}` });
      void answer(req, res, decided, deps);
    });
  });
}

// body-parser reports an oversized body as 413 on the error it passes on.
const rawBodyStatus = (err: unknown): number => (isRecord(err) && typeof err.status === "number" ? err.status : 400);
