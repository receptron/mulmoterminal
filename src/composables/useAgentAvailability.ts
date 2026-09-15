// What this machine can actually launch, and the one correction it is allowed to make (#2082).
//
// The launch form's initial agent is decided synchronously at module scope — `launchAgent` reads
// localStorage, `pickedAgent` starts at "claude" — and availability only arrives over HTTP. So this
// does not choose the initial value; it REPLACES one that turns out to be unlaunchable.
//
// And never against the user. `agentCorrection` answers null unless the value is still the one it
// was initialised with, so someone who deliberately picks the agent they are in the middle of
// installing keeps it. A failed or absent answer also moves nothing — `offerableAgent` treats
// "unknown" as "not missing", so a host too old to serve this route behaves exactly as before.
import { ref } from "vue";
import { parseAgentAvailability, offerableAgent, type AgentAvailability } from "../../common/agentAvailability";
import type { TerminalAgent } from "../../common/sessionAgent";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

const FETCH_TIMEOUT_MS = 8000;

export const agentAvailability = ref<AgentAvailability[]>([]);

// The request currently in the air, so a grid mounting a dozen cells at once asks the server once.
let inFlight: Promise<void> | null = null;
// Whether a fetch has actually SUCCEEDED — the same shape `useLaunchOptions` keeps, for the same
// reason. `inFlight` is cleared when the request settles, so it alone makes this "once per CALLER",
// not "once per page": every `startCollectionChat` would re-ask. And a FAILED fetch must not count,
// or the first attempt losing a race with a server that is still starting would freeze the answer
// at "nothing known" for the rest of the page session.
let loaded = false;

async function fetchAvailability(): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/agents", undefined, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`GET /api/agents → ${res.status}`);
    agentAvailability.value = parseAgentAvailability(await res.json());
    loaded = true;
  } catch (err) {
    // Nothing the user can act on: with no answer the form keeps the agent it already had, which is
    // what every release before this one did.
    console.warn("[agents] availability unknown, keeping the current default:", err);
    agentAvailability.value = [];
  } finally {
    inFlight = null;
  }
}

/** Asked once per page — however many cells mount at once, and however many launches follow. */
export function loadAgentAvailability(): Promise<void> {
  if (loaded) return Promise.resolve();
  inFlight ??= fetchAvailability();
  return inFlight;
}

/** What an agent-holding value should BECOME once availability is known, or null to leave it alone.
 *
 *  Takes and answers plain values rather than the ref, because the two callers hold different types
 *  — `launchAgent` is a TerminalAgent, `pickedAgent` may also be a shell or a custom agent — and the
 *  decision is the same for both: only a value still equal to what it was initialised with, and only
 *  when that value is known to be missing, may move. */
export function agentCorrection(current: string, untouched: TerminalAgent, availability: readonly AgentAvailability[]): TerminalAgent | null {
  if (current !== untouched) return null;
  const next = offerableAgent(untouched, availability);
  return next === untouched ? null : next;
}
