// What ONE cockpit roster row shows, assembled from the four things the grid keeps per cell.
//
// Out of GridView for the reason `rosterAgent` next door is: this is a pure data transformation
// over state the component happens to hold, and a row that says the wrong thing is invisible in a
// component test but obvious in a table of inputs and outputs.
//
// The four lookups are passed rather than imported because each is a DIFFERENT key: the meta is
// per session, the chrome and the phase are per directory (cells sharing a directory share one
// fetch), and the status is per cell. Handing them in as functions is what lets this stay pure
// while the caller keeps its reactive maps.
import type { Cell } from "./gridTabs";
import type { CockpitRow } from "./TerminalGrid.vue";
import type { AttentionStatus } from "./attentionStatus";
import { rosterAgent } from "./rosterAgent";
import { EMPTY_SESSION_META, type PrPhase, type SessionMetaView } from "./rosterPhase";

/** The directory's own look, as the roster row and the filmstrip thumbnail both wear it. */
export interface RowChrome {
  headerColor: string | null;
  headerTextColor: string | null;
  iconUrl: string | null;
}

// "Nothing known yet" is resolved ONCE per lookup rather than per field. Five of the row's fields
// come out of the meta and three out of the chrome, so a `??` on each both crossed the complexity
// limit and made every field independently defaultable — which is how a field the roster never
// wired up reads as a legitimate null rather than failing to typecheck.
const NO_CHROME: RowChrome = { headerColor: null, headerTextColor: null, iconUrl: null };
const NO_PR_PHASE: PrPhase = "none";
const NO_STATUS: AttentionStatus = "idle";

export interface RosterLookups {
  meta: (session: string) => SessionMetaView | undefined;
  chrome: (cwd: string) => RowChrome | undefined;
  phase: (cwd: string) => PrPhase | undefined;
  status: (uid: number) => AttentionStatus | undefined;
}

/** A cell with no session/prompt yet still gets a human label from what it IS running. */
export const fallbackLabel = (c: Cell): string | null => c.command?.label ?? c.launcher?.label ?? (c.session ? "starting…" : "empty");

export function rosterRow(c: Cell, look: RosterLookups): CockpitRow {
  const meta = (c.session ? look.meta(c.session) : undefined) ?? EMPTY_SESSION_META;
  const chrome = (c.cwd ? look.chrome(c.cwd) : undefined) ?? NO_CHROME;
  return {
    uid: c.uid,
    cwd: c.cwd,
    agent: rosterAgent(c),
    status: look.status(c.uid) ?? NO_STATUS,
    memo: meta.memo,
    summary: meta.aiTitle,
    prompt: meta.lastPrompt,
    response: meta.lastResponse,
    fallback: fallbackLabel(c),
    phase: (c.cwd ? look.phase(c.cwd) : undefined) ?? NO_PR_PHASE,
    workPhase: meta.workPhase,
    collection: meta.collection,
    headerColor: chrome.headerColor,
    headerTextColor: chrome.headerTextColor,
    iconUrl: chrome.iconUrl,
    parked: c.parked === true,
  };
}
