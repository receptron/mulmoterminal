// What the cell's own send button says (#3399): the partner it sends to, or how many there are when
// pressing it will ask. Naming the partner is the point — it is what tells a user the two terminals
// can hand turns to each other at all.
import type { SlotInfo } from "./readableSlot";

export type RelayButtonLabel = { kind: "one"; name: string } | { kind: "many"; count: number };

const CELL_KEY_PREFIX = "cell-";

/** `codex #4` for a grid cell, the agent alone for a slot outside the grid. */
export const partnerShortName = (slot: SlotInfo): string =>
  slot.key.startsWith(CELL_KEY_PREFIX) ? `${slot.agent} #${slot.key.slice(CELL_KEY_PREFIX.length)}` : slot.agent;

/** Null when there is no partner, which is when the button is not shown. */
export function relayButtonLabel(partners: readonly SlotInfo[]): RelayButtonLabel | null {
  const [only] = partners;
  if (only === undefined) return null;
  return partners.length === 1 ? { kind: "one", name: partnerShortName(only) } : { kind: "many", count: partners.length };
}
