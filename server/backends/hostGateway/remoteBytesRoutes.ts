// GET /remote/<id>/bytes/api/… — a file or rendered document from a remote host, as bytes (#3506).
//
// The route is decided by the same table rules as the JSON forward (remoteForward.ts) against
// REMOTE_BYTE_ROUTES, so a path stays inside the cell's directory. What comes back is checked by
// bytesPlan: the remote's own `nosniff` and sandboxing policy pass through unchanged, and a response
// without them is refused. A rendered document's links to the remote's files are rewritten onto this
// host's bytes; anything else streams as it came, with a range the browser asked for (media seeks).
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Express, Request, Response } from "express";
import { REMOTE_BYTE_ROUTES } from "../../../common/remoteRoutes.js";
import { remotePathOf } from "../../../common/remoteHosts.js";
import { readChunks } from "../../infra/http/readChunks.js";
import { decideForward } from "./remoteForward.js";
import { BYTES_SEGMENT, bytesPlan, rewriteRenderedDoc } from "./remoteBytes.js";
import { FORWARD_RESPONSE_MAX_BYTES, FORWARD_TIMEOUT_MS } from "./remoteForwardRoutes.js";
import type { RemoteHost } from "./remoteHostsConfig.js";

export interface RemoteBytesDeps {
  remoteHosts: () => readonly RemoteHost[];
  fetchImpl?: typeof fetch;
}

const REMOTE_BYTES = /^\/remote\/[^/]+\/bytes\/api\//;

function refuse(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

// The remote's body, chunk by chunk, for a stream that pauses when the browser does.
async function* chunksOf(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Uint8Array> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

const withoutLength = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "content-length"));

type Target = { host: RemoteHost; path: string } | { status: number; error: string };

function targetOf(req: Request, deps: RemoteBytesDeps): Target {
  const remote = remotePathOf(req.path);
  const host = remote ? deps.remoteHosts().find((candidate) => candidate.id === remote.id) : undefined;
  if (!remote || !host || !remote.rest.startsWith(`${BYTES_SEGMENT}/`)) return { status: 404, error: `no remote host for ${req.path}` };
  const decision = decideForward("GET", remote.rest.slice(BYTES_SEGMENT.length), req.query, REMOTE_BYTE_ROUTES);
  return decision.kind === "refuse" ? { status: decision.status, error: decision.reason } : { host, path: decision.path };
}

// The request headers carried to the remote: its own origin, and a range for a media seek.
function remoteHeaders(req: Request, host: RemoteHost): Record<string, string> {
  const range = req.get("range");
  return { origin: host.origin, accept: "*/*", ...(range ? { range } : {}) };
}

async function sendRendered(res: Response, remoteRes: globalThis.Response, headers: Record<string, string>, hostId: string): Promise<void> {
  const chunks = remoteRes.body ? await readChunks(remoteRes.body.getReader(), FORWARD_RESPONSE_MAX_BYTES) : [];
  if (chunks === null) return refuse(res, 502, "the remote's document is larger than this host forwards");
  // The rewrite changes the length, which Express sets again for the body it sends.
  res
    .status(remoteRes.status)
    .set(withoutLength(headers))
    .send(rewriteRenderedDoc(Buffer.concat(chunks).toString("utf8"), hostId));
}

async function replayBytes(req: Request, res: Response, target: { host: RemoteHost; path: string }, fetchImpl: typeof fetch): Promise<void> {
  const abort = new AbortController();
  // Until the headers arrive only; a stream then runs as long as the browser keeps reading it.
  const timer = setTimeout(() => abort.abort(), FORWARD_TIMEOUT_MS);
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const url = `${target.host.origin}${target.path}`;
  let remoteRes: globalThis.Response;
  try {
    remoteRes = await fetchImpl(url, { headers: remoteHeaders(req, target.host), signal: abort.signal, redirect: "manual" });
  } catch (err) {
    return refuse(res, 502, `could not reach ${target.host.id} (${url}): ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (remoteRes.status >= 300 && remoteRes.status !== 304)
    return refuse(res, remoteRes.status >= 500 ? 502 : remoteRes.status, `${target.host.id} answered ${remoteRes.status}`);
  const plan = bytesPlan((name) => remoteRes.headers.get(name));
  if (!plan.ok) return refuse(res, 502, `${target.host.id}: ${plan.reason}`);
  if (plan.rendered) return sendRendered(res, remoteRes, plan.headers, target.host.id);
  res.status(remoteRes.status).set(plan.headers);
  if (!remoteRes.body) {
    res.end();
    return;
  }
  // A stream the browser walks away from is aborted, and that abort is this pipeline's error to end
  // quietly: left unhandled, it would take the server down.
  await pipeline(Readable.from(chunksOf(remoteRes.body.getReader())), res).catch(() => res.destroy());
}

export function mountRemoteBytesRoutes(app: Express, deps: RemoteBytesDeps): void {
  app.get(REMOTE_BYTES, (req: Request, res: Response) => {
    const target = targetOf(req, deps);
    if ("error" in target) return refuse(res, target.status, target.error);
    replayBytes(req, res, target, deps.fetchImpl ?? fetch).catch((err: unknown) => {
      if (!res.headersSent) refuse(res, 502, `could not forward ${req.path}: ${String(err)}`);
    });
  });
}
