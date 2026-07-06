// Remote-host lifecycle + routes for MulmoTerminal.
//
// Binds MulmoTerminal's Firebase deps + hostId to the shared createRemoteHost
// factory (@mulmoclaude/core/remote-host/server) so connecting from the toolbar
// signs in as the user and starts the Firestore command loop + presence
// heartbeat; disconnecting stops both. The transport engine lives in core; this
// module only supplies host specifics (hostId, handler table, firestore-bound
// runner, logger) and the connect/disconnect/status routes.
//
// Single-account, single-host (HOST_ID = "mulmoterminal", distinct from the
// MulmoClaude host so the two never compete for the same command queue),
// in-memory session: a server restart drops the session and needs a re-connect.
import type { Express, Request } from "express";
import { createRemoteHost, createRemoteHostAuth, startHostRunner, type RemoteHostLifecycle } from "@mulmoclaude/core/remote-host/server";

import { auth, firestore, storage } from "./firebase.js";
import { createRemoteHostHandlers } from "./handlers.js";
import { createSaveAttachment } from "./attachmentStore.js";
import { buildIngestAttachments } from "./ingestAttachments.js";

const HOST_ID = "mulmoterminal";
const PREFIX = "[remote-host]";

// Module-level singleton — one host runner per process. Null until initialized.
let lifecycle: RemoteHostLifecycle | null = null;

export interface RemoteHostBackendDeps {
  workspace: string;
  spawnChat: (message: string) => { chatId: string };
}

export function initRemoteHostBackend(deps: RemoteHostBackendDeps): void {
  const authHelpers = createRemoteHostAuth(auth);
  // Ingest pulls the phone's staged uploads (Firebase Storage, signed in as the
  // user) into data/attachments/ and hands startChat path-only attachments.
  const ingest = buildIngestAttachments({ storage, uid: authHelpers.currentUid, saveAttachment: createSaveAttachment(deps.workspace) });
  lifecycle = createRemoteHost({
    hostId: HOST_ID,
    signIn: authHelpers.signInHost,
    signOut: authHelpers.signOutHost,
    currentUid: authHelpers.currentUid,
    startRunner: (channel, handlers, options) => startHostRunner(firestore, channel, handlers, options),
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

export interface RemoteHostRouteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

export function mountRemoteHostRoutes(app: Express, { isAllowedOrigin }: RemoteHostRouteOptions): void {
  // GET status — connected + uid.
  app.get("/api/remote-host/status", (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    if (!lifecycle) return res.status(503).json({ error: "remote host not initialized" });
    return res.json({ status: lifecycle.status() });
  });

  // POST connect { idToken } — sign in as the user + start the runner. The
  // idToken is a secret: never logged, accepted over the local origin only.
  app.post("/api/remote-host/connect", async (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    if (!lifecycle) return res.status(503).json({ error: "remote host not initialized" });
    const idToken = isRecord(req.body) && typeof req.body.idToken === "string" ? req.body.idToken : "";
    if (!idToken) return res.status(400).json({ error: "idToken is required" });
    try {
      return res.json({ status: await lifecycle.connect(idToken) });
    } catch (err) {
      return res.status(500).json({ error: errorText(err) });
    }
  });

  // POST disconnect — stop the runner + sign out.
  app.post("/api/remote-host/disconnect", async (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    if (!lifecycle) return res.status(503).json({ error: "remote host not initialized" });
    try {
      return res.json({ status: await lifecycle.disconnect() });
    } catch (err) {
      return res.status(500).json({ error: errorText(err) });
    }
  });
}
