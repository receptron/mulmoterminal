// The grid's layout, kept in the browser (`grid_v2`) and copied to the server (#3427). The browser's
// copy is the one the grid runs from; the server's is what a browser that lost its own is offered.
//
// A grid that loads with no sessions HOLDS its writes until the user restores or dismisses the offer:
// its first change would otherwise overwrite the very copy it is offering.
import { ref } from "vue";
import { initialState, LEGACY_KEY, STATE_KEY, type GridState } from "../components/gridTabs";
import { cellsToOffer, sessionIdsOf, type OfferedCell } from "../components/gridLayoutOffer";
import { openCellAt } from "./useNewTerminal";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

const ROUTE = "/api/grid-layout";
const MIRROR_DEBOUNCE_MS = 1000;

/** The cells offered back, or null when there is nothing to offer or the user has decided. */
export const offeredCells = ref<OfferedCell[] | null>(null);

let latest: GridState | null = null;
let held = false;
let unsent = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const body = (state: GridState) => JSON.stringify({ layout: state });

async function send(): Promise<void> {
  timer = null;
  if (!latest || !unsent) return;
  unsent = false;
  try {
    const res = await fetchWithTimeout(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(latest) });
    if (!res.ok) throw new Error(`POST ${ROUTE} → ${res.status}`);
  } catch (err) {
    // Still pending, so leaving the page sends it; no timed retry, since the next change sends it too.
    unsent = true;
    console.warn("[grid-layout] could not copy the layout to the server:", err);
  }
}

function schedule(): void {
  unsent = true;
  if (!held && timer === null) timer = setTimeout(() => void send(), MIRROR_DEBOUNCE_MS);
}

// A change made in the last second before the page goes would otherwise never leave it.
function flushOnLeave(): void {
  if (held || !latest || !unsent) return;
  unsent = false;
  navigator.sendBeacon(ROUTE, new Blob([body(latest)], { type: "application/json" }));
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushOnLeave);

/** Keep this state: in the browser, and (unless held) on the server. A browser that cannot store it —
 *  a full disk — still sends it, which is the case the server's copy is for. Answers whether the
 *  browser stored it. */
export function saveGridState(state: GridState): boolean {
  latest = state;
  schedule();
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn("[grid-layout] the browser could not store the layout:", err);
    return false;
  }
}

function release(): void {
  held = false;
  offeredCells.value = null;
  if (unsent) schedule();
}

const openSessionIds = (): string[] => (latest ? sessionIdsOf(latest) : []);
const stringsIn = (value: unknown): string[] => (isUnknownArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

async function readCopy(): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(ROUTE);
  const answer: unknown = res.ok ? await res.json() : null;
  return isRecord(answer) ? answer : null;
}

async function readOffer(): Promise<void> {
  try {
    const answer = await readCopy();
    const cells = answer ? cellsToOffer(answer.layout, openSessionIds(), stringsIn(answer.attached)) : [];
    if (cells.length > 0) offeredCells.value = cells;
    else release();
  } catch (err) {
    console.warn("[grid-layout] could not read the server's copy of the layout:", err);
    release();
  }
}

/** The grid's starting state, from the browser's copy. When that holds no sessions, the server's copy
 *  is asked for, and writes wait until the user has answered the offer. */
export function loadGridState(): GridState {
  const init = initialState(localStorage.getItem(STATE_KEY), localStorage.getItem(LEGACY_KEY));
  latest = init.state;
  // Dropped only once the new key holds the sessions, so a reload in between cannot lose them.
  if (init.migrated && saveGridState(init.state)) localStorage.removeItem(LEGACY_KEY);
  if (sessionIdsOf(init.state).length === 0) {
    held = true;
    void readOffer();
  }
  return init.state;
}

// Asked again at the moment of restoring: the offer can sit on screen while another tab opens one of
// its sessions, and taking it here would push that tab off it. Unanswerable reads as "none".
async function attachedNow(): Promise<string[]> {
  try {
    return stringsIn((await readCopy())?.attached);
  } catch {
    return [];
  }
}

/** Open the offered cells that are still not on screen anywhere, then let the copy follow this grid again. */
export async function restoreOfferedCells(): Promise<void> {
  const offered = offeredCells.value ?? [];
  offeredCells.value = null; // the bar goes at once, so a second press cannot open them twice
  const shown = new Set([...openSessionIds(), ...(await attachedNow())]);
  offered.filter((cell) => cell.session !== null && !shown.has(cell.session)).forEach((cell) => openCellAt(cell, null));
  release();
}

export const dismissOfferedCells = release;
