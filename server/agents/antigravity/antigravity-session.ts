// Finding the conversation id `agy` minted for a session, so a later cold reconnect can resume it
// with `--conversation <id>`.
//
// Same shape as the codex path (agents/codex/codex-session.ts) and for the same reason: the id is not
// ours to choose and is not printed anywhere we can read, so a fresh session is watched until a
// new conversation directory appears under agy's brain root. Attribution is unambiguous-only —
// two sessions started in the same instant give two new directories and neither is claimed,
// which costs a resume rather than resuming the wrong conversation.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { agentHome } from "../agent-homes.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCH_POLL_MS = 500;
const WATCH_MAX_WAIT_MS = 30 * 60 * 1000;

export function antigravityHome(): string {
  return agentHome("antigravity");
}

export function antigravityBrainRoot(home: string = antigravityHome()): string {
  return path.join(home, "brain");
}

// Where agy keeps a conversation's own database — one file per conversation id, beside the brain
// directory rather than inside it. The transcript and the accounting live in different trees
// (antigravity-usage.ts), so a reader needs both roots and neither is derivable from the other.
export function antigravityConversationsRoot(home: string = antigravityHome()): string {
  return path.join(home, "conversations");
}

/** Is this one of agy's conversation ids? Checked before an id is joined into a path. */
export const isAntigravityConversationId = (id: string): boolean => UUID_RE.test(id);

// One directory per conversation, named by its id. Anything else in there is not a conversation.
export function listAntigravityConversationIds(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => UUID_RE.test(name));
  } catch {
    return [];
  }
}

// Does agy hold a conversation by this id? The cold-resume probe: after a restart the in-memory
// session -> conversation map is gone, so this is all that separates a key worth resuming from a
// key that only ever named a MulmoTerminal session.
export function antigravityConversationExists(root: string, id: string): boolean {
  return UUID_RE.test(id) && existsSync(path.join(root, id));
}

export function snapshotAntigravitySessions(root: string = antigravityBrainRoot()): Set<string> {
  return new Set(listAntigravityConversationIds(root));
}

// The one conversation this session created, or null while that is still ambiguous.
export function pickFreshAntigravitySession(root: string, before: ReadonlySet<string>, claimed?: ReadonlySet<string>): string | null {
  const found = listAntigravityConversationIds(root).filter((id) => !before.has(id) && !claimed?.has(id));
  return found.length === 1 ? (found[0] ?? null) : null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function watchForAntigravitySession(
  root: string,
  before: ReadonlySet<string>,
  opts: { pollMs?: number; maxWaitMs?: number; isCancelled?: () => boolean; claimed?: Set<string> } = {},
): Promise<string | null> {
  const pollMs = opts.pollMs ?? WATCH_POLL_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? WATCH_MAX_WAIT_MS);
  const isCancelled = opts.isCancelled ?? (() => false);
  let result = pickFreshAntigravitySession(root, before, opts.claimed);
  while (!result && Date.now() < deadline && !isCancelled()) {
    await delay(pollMs);
    result = pickFreshAntigravitySession(root, before, opts.claimed);
  }
  // Claimed here, synchronously with the selection, not only in the caller's `.then`: two watchers
  // awaiting the same poll interval would otherwise both pick the same conversation before either
  // claim landed (#1533). The caller's own add stays and is idempotent.
  if (result) opts.claimed?.add(result);
  return result;
}
