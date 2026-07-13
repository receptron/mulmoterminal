// HTTP routes for the remote-host runner, with the lifecycle + session accessors
// INJECTED (not module singletons) so they're testable against a throwaway Express
// app without pulling in Firebase or the handler table. index.ts wires the real
// deps; routes.spec.ts wires fakes.
//
//   GET  /api/remote-host/status                  → { status, session }
//   POST /api/remote-host/connect     { idToken }  → { status, session }
//   POST /api/remote-host/reconnect   { session }  → { status, session } | 401 | 5xx
//   POST /api/remote-host/disconnect               → { status, session: null }
//
// Every response carries the current session blob so the browser can keep its
// localStorage copy fresh (case A', mulmoserver#50); null when disconnected.
import type { Express, Request, Response } from "express";
import type { RemoteHostLifecycle, RemoteHostStatus } from "@mulmoclaude/core/remote-host/server";

interface StatusResponse {
  status: RemoteHostStatus;
  session: string | null;
}
interface ErrorResponse {
  error: string;
}
type RemoteHostResponse = StatusResponse | ErrorResponse;

export interface RemoteHostRouteDeps {
  isAllowedOrigin: (origin?: string) => boolean;
  getLifecycle: () => RemoteHostLifecycle | null;
  exportSession: () => string | null;
  // 401 for a genuinely expired/invalid blob (client drops it), 5xx for a transient
  // failure (client keeps it and can retry).
  reconnectErrorStatus: (err: unknown) => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function mountRemoteHostRoutes(app: Express, deps: RemoteHostRouteDeps): void {
  const respond = (res: Response<RemoteHostResponse>, status: RemoteHostStatus): Response => res.json({ status, session: deps.exportSession() });

  // Origin-guarded (loopback only) + not-initialized guard. Returns the live lifecycle
  // (already sent the error response and returns null when either guard fails).
  const guard = (req: Request, res: Response<RemoteHostResponse>): RemoteHostLifecycle | null => {
    if (!deps.isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ error: "forbidden origin" });
      return null;
    }
    const lifecycle = deps.getLifecycle();
    if (!lifecycle) res.status(503).json({ error: "remote host not initialized" });
    return lifecycle;
  };

  app.get("/api/remote-host/status", (req: Request, res: Response<RemoteHostResponse>) => {
    const lifecycle = guard(req, res);
    if (lifecycle) respond(res, lifecycle.status());
  });

  // The idToken is a secret: never logged, accepted over the local origin only.
  app.post("/api/remote-host/connect", async (req: Request, res: Response<RemoteHostResponse>) => {
    const lifecycle = guard(req, res);
    if (!lifecycle) return;
    const idToken = isRecord(req.body) && typeof req.body.idToken === "string" ? req.body.idToken : "";
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }
    try {
      respond(res, await lifecycle.connect(idToken));
    } catch (err) {
      res.status(500).json({ error: errorText(err) });
    }
  });

  app.post("/api/remote-host/reconnect", async (req: Request, res: Response<RemoteHostResponse>) => {
    const lifecycle = guard(req, res);
    if (!lifecycle) return;
    const session = isRecord(req.body) && typeof req.body.session === "string" ? req.body.session : "";
    if (!session) {
      res.status(400).json({ error: "session is required" });
      return;
    }
    try {
      respond(res, await lifecycle.reconnect(session));
    } catch (err) {
      res.status(deps.reconnectErrorStatus(err)).json({ error: errorText(err) });
    }
  });

  app.post("/api/remote-host/disconnect", async (req: Request, res: Response<RemoteHostResponse>) => {
    const lifecycle = guard(req, res);
    if (!lifecycle) return;
    try {
      respond(res, await lifecycle.disconnect());
    } catch (err) {
      res.status(500).json({ error: errorText(err) });
    }
  });
}
