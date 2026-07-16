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
// The consent flow is a loopback listener on THIS machine, so it can only be started
// where the server runs — a remote browser can't complete it. `mulmoterminal google
// login` (server/cli-google.ts) is that entry point.
import { configureGoogleHost } from "@mulmoclaude/core/google";
import { hostLogger } from "./hostLogger.js";

export function initGoogleBackend(): void {
  configureGoogleHost({ log: hostLogger });
}
