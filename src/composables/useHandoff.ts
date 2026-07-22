// Bring another terminal's last completed exchange into THIS one's input box (#550).
// The excerpt is read from that agent's own log and rendered server-side; this side
// only picks which terminal to read and pastes the result locally.
//
// The direction is pull, not push (#574): the cell you clicked is the cell the text
// lands in, so you read what arrived and press Enter without moving. Pushing put the
// text in a pane you weren't looking at — possibly on another grid page — and left the
// Enter to be pressed somewhere else. It is still never submitted for you, which is
// what keeps another agent's output from acting as an instruction on its own.
import { pasteText, listSlots } from "./useTerminalConnections";
import type { SlotInfo } from "./readableSlot";
import { formatCwd } from "../components/cwdDisplay";

// A terminal whose last exchange can be pulled: how to name it in the menu, and what
// the server needs to find its log.
export interface HandoffTarget {
  key: string;
  label: string;
  source: HandoffSource;
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
  return slots
    .filter((slot) => slot.key !== selfKey)
    .map((slot) => ({
      key: slot.key,
      label: slotLabel(slot, home),
      source: { sessionId: slot.sessionId, cwd: slot.cwd, agent: slot.agent },
    }));
}

export const handoffTargets = (selfKey: string, home: string | null): HandoffTarget[] => pickHandoffTargets(listSlots(), selfKey, home);

const REQUEST_TIMEOUT_MS = 10_000;

export interface FetchedTurn {
  prompt: string | null;
  reply: string | null;
  text: string;
}

// `shape: "reply"` asks for the answer alone — see the server's HandoffShape.
export async function fetchLastTurn(source: HandoffSource, shape: "exchange" | "reply" = "exchange"): Promise<FetchedTurn> {
  const params = new URLSearchParams({ session: source.sessionId, agent: source.agent });
  if (shape === "reply") params.set("as", "reply");
  if (source.cwd) params.set("cwd", source.cwd);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/transcript/last-turn?${params.toString()}`, { signal: abort.signal });
    if (!res.ok) throw new Error(`last-turn request failed (${res.status})`);
    const data: unknown = await res.json();
    if (!isRecord(data)) return { prompt: null, reply: null, text: "" };
    const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
    return { prompt: str(data.prompt), reply: str(data.reply), text: str(data.text) ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

const fetchHandoffText = async (source: HandoffSource): Promise<string> => (await fetchLastTurn(source)).text;

// The excerpt fetch and the paste, injected so the outcome rules below can be tested
// without a server or a live socket.
export interface HandoffDeps {
  fetchText: (source: HandoffSource) => Promise<string>;
  paste: (destKey: string, text: string) => boolean;
}
const defaultDeps: HandoffDeps = { fetchText: fetchHandoffText, paste: pasteText };

// Returns null on success, or a short message to show on the cell. "Nothing to bring
// over" is its own outcome because it is the EXPECTED one for a fresh session, and for
// a codex session whose newest turn hasn't been flushed to its rollout yet — neither is
// a failure the user should read as broken.
export async function pullLastTurn(target: HandoffTarget, ownKey: string, deps: HandoffDeps = defaultDeps): Promise<string | null> {
  let text: string;
  try {
    text = await deps.fetchText(target.source);
  } catch {
    return "Could not read that terminal's last turn";
  }
  if (!text) return "That terminal has no completed turn yet";
  return deps.paste(ownKey, text) ? null : "This terminal is not connected";
}
