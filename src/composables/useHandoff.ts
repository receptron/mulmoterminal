// Hand one terminal's last completed exchange to another terminal (#550). The excerpt
// is read from the agent's own log and rendered server-side; this side only picks the
// destination and pastes. It is never submitted — the human reads what landed in the
// input box and presses Enter, which is also what bounds the prompt-injection surface.
import { pasteText, listSlots, type SlotInfo } from "./useTerminalConnections";
import { formatCwd } from "../components/cwdDisplay";

export interface HandoffTarget {
  key: string;
  label: string;
}

export interface HandoffSource {
  sessionId: string;
  cwd: string | null;
  agent: "claude" | "codex";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// Slot keys are `cell-<uid>`; the uid is what the user sees on the cell, so a menu
// entry reads the same way the grid does.
const slotLabel = (slot: SlotInfo, home: string | null): string => {
  const cell = slot.key.startsWith("cell-") ? `#${slot.key.slice("cell-".length)}` : slot.key;
  return slot.cwd ? `${cell} · ${slot.agent} · ${formatCwd(slot.cwd, home, 24)}` : `${cell} · ${slot.agent}`;
};

export function pickHandoffTargets(slots: SlotInfo[], selfKey: string, home: string | null): HandoffTarget[] {
  return slots.filter((slot) => slot.key !== selfKey).map((slot) => ({ key: slot.key, label: slotLabel(slot, home) }));
}

export const handoffTargets = (selfKey: string, home: string | null): HandoffTarget[] => pickHandoffTargets(listSlots(), selfKey, home);

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchHandoffText(source: HandoffSource): Promise<string> {
  const params = new URLSearchParams({ session: source.sessionId, agent: source.agent });
  if (source.cwd) params.set("cwd", source.cwd);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/transcript/last-turn?${params.toString()}`, { signal: abort.signal });
    if (!res.ok) throw new Error(`last-turn request failed (${res.status})`);
    const data: unknown = await res.json();
    return isRecord(data) && typeof data.text === "string" ? data.text : "";
  } finally {
    clearTimeout(timer);
  }
}

// The excerpt fetch and the paste, injected so the outcome rules below can be tested
// without a server or a live socket.
export interface HandoffDeps {
  fetchText: (source: HandoffSource) => Promise<string>;
  paste: (destKey: string, text: string) => boolean;
}
const defaultDeps: HandoffDeps = { fetchText: fetchHandoffText, paste: pasteText };

// Returns null on success, or a short message to show on the cell. "Nothing to hand
// over" is its own outcome because it is the EXPECTED one on a fresh session, and on a
// codex session whose newest turn hasn't been flushed to its rollout yet — neither is
// a failure the user should read as broken.
export async function handoffLastTurn(source: HandoffSource, destKey: string, deps: HandoffDeps = defaultDeps): Promise<string | null> {
  let text: string;
  try {
    text = await deps.fetchText(source);
  } catch {
    return "Could not read the last turn";
  }
  if (!text) return "No completed turn to hand over yet";
  return deps.paste(destKey, text) ? null : "That terminal is not connected";
}
