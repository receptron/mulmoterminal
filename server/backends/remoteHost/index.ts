// Remote-host lifecycle + routes for MulmoTerminal.
//
// Binds MulmoTerminal's Firebase deps + hostId to the shared createRemoteHost
// factory (@mulmoclaude/core/remote-host/server) so connecting from the toolbar
// signs in as the user and starts the Firestore command loop + presence
// heartbeat; disconnecting stops both. The transport engine lives in core; this
// module only supplies host specifics (hostId, handler table, session-backed
// runner, logger) and the connect/reconnect/disconnect/status routes.
//
// Single-account, single-host (HOST_ID = "mulmoterminal", distinct from the
// MulmoClaude host so the two never compete for the same command queue). The
// Firebase session is parked in the browser (case A', mulmoserver#50), so a
// server restart doesn't force a re-login: the client reconnects from its stored
// blob. The runner reads the CURRENT session's firestore/storage (both change on
// each (re)connect — see session.ts).
import type { Express, Request, Response } from "express";
import { createRemoteHost, startHostRunner, type RemoteHostLifecycle, type RemoteHostStatus } from "@mulmoclaude/core/remote-host/server";

import { createRemoteHostHandlers } from "./handlers.js";
import { createSaveAttachment } from "./attachmentStore.js";
import { buildIngestAttachments } from "./ingestAttachments.js";
import { onExpire } from "./onExpire.js";
import { currentFirestore, currentStorage, currentUid, exportSession, reconnectErrorStatus, restore, signIn, signOut } from "./session.js";

const HOST_ID = "mulmoterminal";
const PREFIX = "[remote-host]";

// Module-level singleton — one host runner per process. Null until initialized.
let lifecycle: RemoteHostLifecycle | null = null;

export interface RemoteHostBackendDeps {
  workspace: string;
  spawnChat: (message: string) => { chatId: string };
}

export function initRemoteHostBackend(deps: RemoteHostBackendDeps): void {
  // Ingest pulls the phone's staged uploads (Firebase Storage, signed in as the
  // user) into data/attachments/ and hands startChat path-only attachments. Reads
  // the LIVE session's storage/uid (both change per (re)connect — see session.ts).
  const ingest = buildIngestAttachments({ storage: currentStorage, uid: currentUid, saveAttachment: createSaveAttachment(deps.workspace) });
  lifecycle = createRemoteHost({
    hostId: HOST_ID,
    signIn,
    restore,
    signOut,
    currentUid,
    startRunner: (channel, handlers, options) => startHostRunner(currentFirestore(), channel, handlers, options),
    // Expired offline-queued startChat commands: delete the phone's staged
    // Storage uploads before the runner removes the doc (protocol v2 offline queue).
    onExpire,
    handlers: createRemoteHostHandlers({ workspace: deps.workspace, spawnChat: deps.spawnChat, ingest }),
    log: {
      info: (msg) => console.log(PREFIX, msg),
      warn: (msg) => console.warn(PREFIX, msg),
      debug: () => undefined,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface StatusResponse {
  status: RemoteHostStatus;
  // The session blob the browser parks in localStorage; null when disconnected.
  session: string | null;
}
interface ErrorResponse {
  error: string;
}
type RemoteHostResponse = StatusResponse | ErrorResponse;

// Every response carries the current session blob so the browser can keep its
// localStorage copy fresh (the refresh token can rotate); null when disconnected.
const respond = (res: Response<RemoteHostResponse>, status: RemoteHostStatus): Response => res.json({ status, session: exportSession() });

export interface RemoteHostRouteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

export function mountRemoteHostRoutes(app: Express, { isAllowedOrigin }: RemoteHostRouteOptions): void {
  const guard = (req: Request, res: Response<RemoteHostResponse>): boolean => {
    if (!isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ error: "forbidden origin" });
      return false;
    }
    if (!lifecycle) {
      res.status(503).json({ error: "remote host not initialized" });
      return false;
    }
    return true;
  };

  // GET status — connected + uid + the current session blob.
  app.get("/api/remote-host/status", (req: Request, res: Response<RemoteHostResponse>) => {
    if (!guard(req, res) || !lifecycle) return;
    respond(res, lifecycle.status());
  });

  // POST connect { idToken } — sign in as the user + start the runner. The idToken
  // is a secret: never logged, accepted over the local origin only.
  app.post("/api/remote-host/connect", async (req: Request, res: Response<RemoteHostResponse>) => {
    if (!guard(req, res) || !lifecycle) return;
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

  // POST reconnect { session } — popup-free restore from a browser-parked blob. A
  // genuinely expired/invalid blob is 401 (client drops it, falls back to connect);
  // transient failures are 5xx so the client KEEPS the blob and can retry later.
  app.post("/api/remote-host/reconnect", async (req: Request, res: Response<RemoteHostResponse>) => {
    if (!guard(req, res) || !lifecycle) return;
    const session = isRecord(req.body) && typeof req.body.session === "string" ? req.body.session : "";
    if (!session) {
      res.status(400).json({ error: "session is required" });
      return;
    }
    try {
      respond(res, await lifecycle.reconnect(session));
    } catch (err) {
      // 401 = the blob is genuinely expired/invalid (client drops it, falls back to
      // Connect); 5xx = transient (client keeps the blob and can retry later).
      res.status(reconnectErrorStatus(err)).json({ error: errorText(err) });
    }
  });

  // POST disconnect — stop the runner + sign out.
  app.post("/api/remote-host/disconnect", async (req: Request, res: Response<RemoteHostResponse>) => {
    if (!guard(req, res) || !lifecycle) return;
    try {
      respond(res, await lifecycle.disconnect());
    } catch (err) {
      res.status(500).json({ error: errorText(err) });
    }
  });
}
