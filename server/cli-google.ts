// `npx mulmoterminal google login` — link a Google account (spawned via tsx by
// bin/mulmoterminal.js).
//
// Consent is a loopback listener on THIS machine, so it can only be completed by a
// browser that can reach 127.0.0.1 — a phone or a remote browser can't, which is why
// linking is a CLI action rather than a button in the web UI. The token core writes is
// shared with MulmoClaude (see backends/google.ts).
import { authorizeGoogle, clientSecretPresence, googleSecretsDir, googleTokenPath } from "@mulmoclaude/core/google";
import type { ClientSecretPresence } from "@mulmoclaude/core/google";
import { initGoogleBackend } from "./backends/google.js";

const log = (message: string) => console.log(`\x1b[36m[google]\x1b[0m ${message}`);
const error = (message: string) => console.error(`\x1b[31m[google]\x1b[0m ${message}`);

// "ambiguous" and "missing" need different fixes (remove duplicates vs download
// credentials), so they must not collapse into one message.
function secretProblem(presence: ClientSecretPresence): string[] {
  const dir = googleSecretsDir();
  if (presence === "ambiguous") {
    return [`Found multiple client_secret_*.json files in ${dir}.`, "Keep exactly one and re-run."];
  }
  return [
    `No OAuth client secret found in ${dir}.`,
    "Create a Desktop OAuth client in the Google Cloud Console, download its JSON,",
    "save it there as client_secret_*.json, then re-run.",
  ];
}

async function login(): Promise<number> {
  const presence = await clientSecretPresence();
  if (presence !== "found") {
    secretProblem(presence).forEach(error);
    return 1;
  }
  await authorizeGoogle({
    onAuthUrl: (url) => {
      log("Open this URL in a browser on this machine to grant access:");
      console.log(`\n  ${url}\n`);
      log("Waiting for the redirect…");
    },
  });
  log(`Linked. Refresh token saved to ${googleTokenPath()}`);
  return 0;
}

function printHelp(): void {
  console.log(`
Usage: npx mulmoterminal google <command>

Commands:
  login    Link a Google account (browser consent, on this machine)
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command !== "login") {
    error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  initGoogleBackend();
  process.exitCode = await login();
}

main().catch((cause: unknown) => {
  error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
