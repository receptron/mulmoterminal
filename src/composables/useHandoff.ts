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
import { isRecord } from "../../common/isRecord";
import type { TerminalAgent } from "../../common/sessionAgent";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

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
  agent: TerminalAgent;
}

// Slot keys are `cell-<uid>`, and the uid is an ARRAY POSITION — renumbered on every grid parse
// (useTerminalConnections.ts, `attach`) and shown on no cell. `#3` therefore names nothing the
// reader can point at, and two terminals in one directory differ here by that number alone (#2005).
export const slotLabel = (slot: SlotInfo, home: string | null): string => {
  const cell = slot.key.startsWith("cell-") ? `#${slot.key.slice("cell-".length)}` : slot.key;
  return slot.cwd ? `${cell} · ${slot.agent} · ${formatCwd(slot.cwd, home, 24)}` : `${cell} · ${slot.agent}`;
};

export const toHandoffTarget = (slot: SlotInfo, home: string | null): HandoffTarget => ({
  key: slot.key,
  label: slotLabel(slot, home),
  source: { sessionId: slot.sessionId, cwd: slot.cwd, agent: slot.agent },
});

export function pickHandoffTargets(slots: SlotInfo[], selfKey: string, home: string | null): HandoffTarget[] {
  return slots.filter((slot) => slot.key !== selfKey).map((slot) => toHandoffTarget(slot, home));
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
  // No try/catch: the caller decides what a failed handoff means, and it always did — the block
  // that used to be here existed only to clear the timer.
  const res = await fetchWithTimeout(`/api/transcript/last-turn?${params.toString()}`, undefined, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`last-turn request failed (${res.status})`);
  const data: unknown = await res.json();
  if (!isRecord(data)) return { prompt: null, reply: null, text: "" };
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return { prompt: str(data.prompt), reply: str(data.reply), text: str(data.text) ?? "" };
}

const fetchHandoffText = async (source: HandoffSource): Promise<string> => (await fetchLastTurn(source)).text;

// The excerpt fetch and the paste, injected so the outcome rules below can be tested
// without a server or a live socket.
export interface HandoffDeps {
  fetchText: (source: HandoffSource) => Promise<string>;
  paste: (destKey: string, text: string) => boolean;
  /** Does `destKey` still run the conversation the user aimed at? Asked at paste time, because the
   *  reads before it can outlast a session switch in that cell. Absent means "nothing to check". */
  holds?: (destKey: string) => boolean;
}
export const defaultDeps: HandoffDeps = { fetchText: fetchHandoffText, paste: pasteText };

// The same outcomes read from either end: pulling, the source is "that" terminal and the paste lands
// "here"; sending, the other way round.
interface HandoffWords {
  source: string;
  Source: string;
  Dest: string;
  destDir: string;
}
const PULL_WORDS: HandoffWords = { source: "that terminal's", Source: "That terminal has", Dest: "This terminal is", destDir: "This terminal has" };
const SEND_WORDS: HandoffWords = { source: "this terminal's", Source: "This terminal has", Dest: "That terminal is", destDir: "That terminal has" };

// Returns null on success, or a short message to show on the cell. "Nothing to bring
// over" is its own outcome because it is the EXPECTED one for a fresh session, and for
// a codex session whose newest turn hasn't been flushed to its rollout yet — neither is
// a failure the user should read as broken.
export const pullLastTurn = (target: HandoffTarget, ownKey: string, deps: HandoffDeps = defaultDeps): Promise<string | null> =>
  pasteLastTurn(target.source, ownKey, PULL_WORDS, deps);

/** The other direction (#3397): this cell's last exchange into `partner`'s input box. */
export const sendLastTurn = (self: HandoffSource, partner: HandoffTarget, deps: HandoffDeps = defaultDeps): Promise<string | null> =>
  pasteLastTurn(self, partner.key, SEND_WORDS, deps);

async function pasteLastTurn(source: HandoffSource, destKey: string, words: HandoffWords, deps: HandoffDeps): Promise<string | null> {
  let text: string;
  try {
    text = await deps.fetchText(source);
  } catch {
    return `Could not read ${words.source} last turn`;
  }
  if (!text) return `${words.Source} no completed turn yet`;
  if (deps.holds && !deps.holds(destKey)) return `${words.Dest} in a different conversation now`;
  return deps.paste(destKey, text) ? null : `${words.Dest} not connected`;
}

/** The one failure that still pasted: a caller that moves to the destination after a paste moves on this too. */
export const RELAY_MARK_UNSAVED = "Pasted, but where it ended could not be saved — the next relay will repeat it";

// Every exchange since the last relay to `destCwd` (#3389). The marker is recorded only after the
// paste succeeded, so a failed paste brings the same exchanges again next time.
export interface RelayFetched {
  status: "ok" | "no-turn" | "nothing-new";
  text: string;
  mark: string | null;
}

const relayParams = (source: HandoffSource, destCwd: string): string => {
  const params = new URLSearchParams({ session: source.sessionId, agent: source.agent, dest: destCwd });
  if (source.cwd) params.set("cwd", source.cwd);
  return params.toString();
};

const RELAY_STATUSES: readonly RelayFetched["status"][] = ["ok", "no-turn", "nothing-new"];
const isRelayStatus = (value: unknown): value is RelayFetched["status"] => RELAY_STATUSES.some((status) => status === value);

async function fetchRelay(source: HandoffSource, destCwd: string): Promise<RelayFetched> {
  const res = await fetchWithTimeout(`/api/transcript/relay?${relayParams(source, destCwd)}`, undefined, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`relay request failed (${res.status})`);
  const data: unknown = await res.json();
  if (!isRecord(data) || !isRelayStatus(data.status)) return { status: "no-turn", text: "", mark: null };
  return { status: data.status, text: typeof data.text === "string" ? data.text : "", mark: typeof data.mark === "string" ? data.mark : null };
}

async function recordRelayMark(source: HandoffSource, destCwd: string, mark: string): Promise<void> {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mark }) };
  const res = await fetchWithTimeout(`/api/transcript/relay-mark?${relayParams(source, destCwd)}`, init, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`relay-mark request failed (${res.status})`);
}

export interface RelayDeps {
  fetchRelay: (source: HandoffSource, destCwd: string) => Promise<RelayFetched>;
  paste: (destKey: string, text: string) => boolean;
  recordMark: (source: HandoffSource, destCwd: string, mark: string) => Promise<void>;
  holds?: (destKey: string) => boolean;
}
export const defaultRelayDeps: RelayDeps = { fetchRelay, paste: pasteText, recordMark: recordRelayMark };

// Null on success, or a short message for the cell — like pullLastTurn.
export const pullSinceRelay = (target: HandoffTarget, ownKey: string, destCwd: string | null, deps: RelayDeps = defaultRelayDeps): Promise<string | null> =>
  pasteSinceRelay(target.source, ownKey, destCwd, PULL_WORDS, deps);

/** The other direction (#3397): this cell's exchanges since the last relay to `partner`'s directory. */
export const sendSinceRelay = (self: HandoffSource, partner: HandoffTarget, deps: RelayDeps = defaultRelayDeps): Promise<string | null> =>
  pasteSinceRelay(self, partner.key, partner.source.cwd, SEND_WORDS, deps);

async function pasteSinceRelay(source: HandoffSource, destKey: string, destCwd: string | null, words: HandoffWords, deps: RelayDeps): Promise<string | null> {
  if (!destCwd) return `${words.destDir} no directory to remember the relay by`;
  let relay: RelayFetched;
  try {
    relay = await deps.fetchRelay(source, destCwd);
  } catch {
    return `Could not read ${words.source} conversation`;
  }
  if (relay.status === "nothing-new") return "Nothing new since the last relay";
  if (relay.status === "no-turn" || !relay.text || relay.mark === null) return `${words.Source} no completed turn yet`;
  if (deps.holds && !deps.holds(destKey)) return `${words.Dest} in a different conversation now`;
  if (!deps.paste(destKey, relay.text)) return `${words.Dest} not connected`;
  try {
    await deps.recordMark(source, destCwd, relay.mark);
  } catch {
    return RELAY_MARK_UNSAVED;
  }
  return null;
}
