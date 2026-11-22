// The send / bring cell actions (#3397): find the partner, hand the text over, and after a send take
// the user to where it landed — the condition #574 moved the handoff to pull for. Text that arrives in
// a pane nobody is looking at, with its Enter to be pressed somewhere else, is what must not happen.
import type { CellSelfAction } from "../../common/headerActions";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { listSlots } from "./useTerminalConnections";
import type { SlotInfo } from "./readableSlot";
import { relayPartners } from "./relayPartners";
import {
  defaultDeps,
  defaultRelayDeps,
  pullLastTurn,
  pullSinceRelay,
  sendLastTurn,
  sendSinceRelay,
  toHandoffTarget,
  type HandoffSource,
  type HandoffTarget,
} from "./useHandoff";

export const RELAY_ACTIONS = [
  "terminal-send-turn",
  "terminal-send-since",
  "terminal-bring-turn",
  "terminal-bring-since",
] as const satisfies readonly CellSelfAction[];
export type RelayAction = (typeof RELAY_ACTIONS)[number];

const SEND_ACTIONS: readonly RelayAction[] = ["terminal-send-turn", "terminal-send-since"];
export const isSendAction = (action: RelayAction): boolean => SEND_ACTIONS.includes(action);

export type PartnerPick = { kind: "none" } | { kind: "one"; partner: HandoffTarget } | { kind: "choose" };

export const pickOf = (partners: readonly HandoffTarget[]): PartnerPick => {
  if (partners.length === 0) return { kind: "none" };
  const [only] = partners;
  return partners.length === 1 && only ? { kind: "one", partner: only } : { kind: "choose" };
};

const WORKTREES_TIMEOUT_MS = 10_000;

export async function fetchWorktreePaths(cwd: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`, undefined, WORKTREES_TIMEOUT_MS);
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const rows = isRecord(body) && Array.isArray(body.worktrees) ? body.worktrees : [];
    return rows.flatMap((row: unknown) => (isRecord(row) && typeof row.path === "string" ? [row.path] : []));
  } catch {
    return [];
  }
}

export interface PartnerDeps {
  slots: () => SlotInfo[];
  worktreePaths: (cwd: string) => Promise<string[]>;
}
const defaultPartnerDeps: PartnerDeps = { slots: listSlots, worktreePaths: fetchWorktreePaths };

/** The repo's worktrees are asked for only when some terminal sits outside this one's directory: it
 *  is a git call per worktree, and the common case — two agents in one directory — needs none. */
export async function findPartner(selfKey: string, selfCwd: string | null, home: string | null, deps: PartnerDeps = defaultPartnerDeps): Promise<PartnerPick> {
  const slots = deps.slots();
  const sameDir = relayPartners(slots, selfKey, selfCwd, []);
  const elsewhere = slots.some((slot) => slot.key !== selfKey && slot.cwd !== null && !sameDir.includes(slot));
  const paths = elsewhere && selfCwd ? await deps.worktreePaths(selfCwd) : [];
  return pickOf(relayPartners(slots, selfKey, selfCwd, paths).map((slot) => toHandoffTarget(slot, home)));
}

export interface RelaySelf {
  key: string;
  source: HandoffSource;
}

const runsSession = (key: string, sessionId: string): boolean => listSlots().some((slot) => slot.key === key && slot.sessionId === sessionId);

/** Null on success, or the message to show on the cell. The paste lands only while the destination
 *  still runs the session it ran when the action started — the partner's for a send, this cell's for
 *  a bring — the same check useCrossTalk makes before every submit. `pasted` fires as it lands, so a
 *  caller moving there does not wait for the relay mark to be saved. */
export function runRelay(
  action: RelayAction,
  self: RelaySelf,
  partner: HandoffTarget,
  pasted: () => void = () => {},
  holds: typeof runsSession = runsSession,
): Promise<string | null> {
  const into = (session: string) => ({ holds: (key: string) => holds(key, session), pasted });
  const toPartner = into(partner.source.sessionId);
  const toSelf = into(self.source.sessionId);
  if (action === "terminal-send-turn") return sendLastTurn(self.source, partner, { ...defaultDeps, ...toPartner });
  if (action === "terminal-send-since") return sendSinceRelay(self.source, partner, { ...defaultRelayDeps, ...toPartner });
  if (action === "terminal-bring-turn") return pullLastTurn(partner, self.key, { ...defaultDeps, ...toSelf });
  return pullSinceRelay(partner, self.key, self.source.cwd, { ...defaultRelayDeps, ...toSelf });
}
