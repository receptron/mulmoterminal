import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCH_POLL_MS = 500;
const WATCH_MAX_WAIT_MS = 30 * 60 * 1000;

export interface AntigravitySessionMeta {
  id: string;
}

export function antigravityHome(): string {
  return process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), ".gemini", "antigravity-cli");
}

export function antigravityBrainRoot(): string {
  return path.join(antigravityHome(), "brain");
}

export function ensureAntigravityMcpConfig(): void {
  const file = path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
  try {
    const dir = path.dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(
      {
        mcpServers: {
          "mulmoterminal-render": {
            serverUrl: "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/render/${MULMOTERMINAL_SESSION_ID}",
          },
          "mulmoterminal-media": {
            serverUrl: "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/media/${MULMOTERMINAL_SESSION_ID}",
          },
          "mulmoterminal-data": {
            serverUrl: "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/data/${MULMOTERMINAL_SESSION_ID}",
          },
          "mulmoterminal-gui": {
            serverUrl: "http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/${MULMOTERMINAL_SESSION_ID}",
          },
        },
      },
      null,
      2,
    );
    writeFileSync(file, content, "utf8");
  } catch {}
}

export function listAntigravitySessions(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => UUID_RE.test(name));
  } catch {
    return [];
  }
}

export function snapshotAntigravitySessions(root: string = antigravityBrainRoot()): Set<string> {
  return new Set(listAntigravitySessions(root));
}

export function pickFreshAntigravitySession(
  root: string,
  before: Set<string>,
  claimed?: Set<string>,
): AntigravitySessionMeta | null {
  const found = listAntigravitySessions(root).filter((id) => !before.has(id) && !claimed?.has(id));
  if (found.length === 1) {
    return { id: found[0] };
  }
  return null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function watchForAntigravitySession(
  root: string,
  before: Set<string>,
  opts: { pollMs?: number; maxWaitMs?: number; isCancelled?: () => boolean; claimed?: Set<string> } = {},
): Promise<AntigravitySessionMeta | null> {
  const pollMs = opts.pollMs ?? WATCH_POLL_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? WATCH_MAX_WAIT_MS);
  const isCancelled = opts.isCancelled ?? (() => false);
  let result = pickFreshAntigravitySession(root, before, opts.claimed);
  while (!result && Date.now() < deadline && !isCancelled()) {
    await delay(pollMs);
    result = pickFreshAntigravitySession(root, before, opts.claimed);
  }
  return result;
}
