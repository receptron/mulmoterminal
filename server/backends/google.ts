// Google (local OAuth + Calendar) host shim — the same pattern as the collection
// engine (backends/collections.ts): @mulmoclaude/core/google owns the logic and the
// host injects its logger once at boot.
//
// Storage is core's, and deliberately host-neutral + SHARED: the refresh token lives
// at ~/.config/mulmo/google-token.json and the OAuth client secret at
// ~/.secrets/client_secret_*.json. Linking once on a machine therefore serves both
// MulmoTerminal and MulmoClaude (mulmoclaude#2124 moved the token off the
// mulmoclaude-branded path for exactly this reason, migrating older files on read).
//
// The consent flow's loopback listener binds on THIS machine, so the browser that
// completes it must run here too. That's the normal case (the UI is served at
// localhost), which is why Settings can drive it; `mulmoterminal google login`
// (server/cli-google.ts) covers the setups where it can't — a remote/phone browser.
import type { Express, Request, Response } from "express";
import {
  clientSecretPresence,
  configureGoogleHost,
  googleAuthFlow,
  loadGoogleTokens,
  unlinkGoogle,
  type ClientSecretPresence,
  type GoogleAuthFlow,
} from "@mulmoclaude/core/google";
import { hostLogger } from "./hostLogger.js";

export function initGoogleBackend(): void {
  configureGoogleHost({ log: hostLogger });
}

export interface GoogleStatus {
  linked: boolean;
  pending: boolean;
  clientSecret: ClientSecretPresence;
  lastError: string | null;
}

// Injectable so the routes are testable without a browser, a token, or a real
// loopback listener.
export interface GoogleRouteDeps {
  authFlow: GoogleAuthFlow;
  unlink: typeof unlinkGoogle;
  secretPresence: typeof clientSecretPresence;
  loadTokens: typeof loadGoogleTokens;
}

const liveDeps: GoogleRouteDeps = {
  authFlow: googleAuthFlow,
  unlink: unlinkGoogle,
  secretPresence: clientSecretPresence,
  loadTokens: loadGoogleTokens,
};

interface GoogleRouteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

const failed = (res: Response, cause: unknown, fallback: string): void => {
  const message = cause instanceof Error ? cause.message : fallback;
  hostLogger.warn("google", fallback, { error: message });
  res.status(500).json({ error: message });
};

// A refresh token is what survives a restart, so its presence — not an access
// token — is what "linked" means. The token itself never leaves the host.
async function readStatus(deps: GoogleRouteDeps): Promise<GoogleStatus> {
  const [tokens, clientSecret] = await Promise.all([deps.loadTokens(), deps.secretPresence()]);
  const flow = deps.authFlow.status();
  return { linked: Boolean(tokens?.refresh_token), pending: flow.pending, clientSecret, lastError: flow.lastError };
}

// Same-origin guarded like the other local-action routes (files/pick-file.ts): without
// it, any site the user visits could POST /unlink and silently drop their account link.
export function mountGoogleRoutes(app: Express, { isAllowedOrigin }: GoogleRouteOptions, deps: GoogleRouteDeps = liveDeps): void {
  const forbidden = (req: Request, res: Response): boolean => {
    if (isAllowedOrigin(req.headers.origin)) return false;
    res.status(403).json({ error: "forbidden origin" });
    return true;
  };

  app.get("/api/google/status", async (req: Request, res: Response) => {
    if (forbidden(req, res)) return;
    try {
      res.json(await readStatus(deps));
    } catch (cause) {
      failed(res, cause, "google status failed");
    }
  });

  // Returns the consent URL immediately; the flow itself resolves later, out of band,
  // when the user finishes consent in the browser (the client polls /status).
  app.post("/api/google/authorize", async (req: Request, res: Response) => {
    if (forbidden(req, res)) return;
    try {
      res.json(await deps.authFlow.start());
    } catch (cause) {
      failed(res, cause, "google authorize failed");
    }
  });

  app.post("/api/google/unlink", async (req: Request, res: Response) => {
    if (forbidden(req, res)) return;
    try {
      await deps.unlink();
      res.json({ linked: false });
    } catch (cause) {
      failed(res, cause, "google unlink failed");
    }
  });
}
