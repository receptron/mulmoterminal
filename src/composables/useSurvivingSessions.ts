// The sessions that outlived the server, for the Settings list (#1478).
//
// Fetched on demand rather than kept fresh: the answer changes when a session starts, ends or is
// stopped, and the only place it is read is a settings section the user has just opened. `reload`
// is what the stop button calls, so what a row says is always the server's latest answer.
import { ref } from "vue";
import type { SurvivingSession } from "../../common/survivingSessions";
import { isTerminalAgent } from "../../common/sessionAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { REAP_INTERVAL_HOURS_OFF, sanitizeReapIntervalHours } from "../../common/sessionReap";

// Every field the row renders or acts on. `key` above all: it is what the stop button posts to
// `/api/session/:id/terminate`, so a row that cannot name it is not a row worth drawing.
const isSurvivingSession = (row: unknown): row is SurvivingSession =>
  isRecord(row) &&
  typeof row.key === "string" &&
  (row.cwd === null || typeof row.cwd === "string") &&
  (row.agent === null || (typeof row.agent === "string" && isTerminalAgent(row.agent))) &&
  (row.idleSeconds === null || typeof row.idleSeconds === "number") &&
  typeof row.attached === "boolean" &&
  typeof row.resumable === "boolean" &&
  // Required like the rest, and worth saying why: absent would assert as `undefined`, read as
  // false, and quietly drop the "ends at next start" mark from a row the server is about to end —
  // the one thing on this row nobody would think to double-check (Codex on #1486).
  typeof row.reapable === "boolean";

const FETCH_TIMEOUT_MS = 8000;

export function useSurvivingSessions() {
  const sessions = ref<SurvivingSession[]>([]);
  // True until the first answer lands, so "none survived" and "not asked yet" do not look alike —
  // an empty list is the good outcome here and deserves to be said out loud.
  const loading = ref(true);
  const failed = ref(false);
  // The cadence the SERVER armed, which is not the cadence in the config: the timer is armed once
  // at boot and not re-armed on a POST, so the two disagree from a save until the next restart
  // (#2184). A row's promise is decided from this one.
  //
  // Falls back to OFF rather than to the saved value when the server does not say — an older
  // server, or a body we could not read. Understating ("ends at next start") is the safe
  // direction: it can only be pessimistic about when a session goes, where the other way round
  // promises a sweep that may not be scheduled.
  const armedIntervalHours = ref(REAP_INTERVAL_HOURS_OFF);

  async function reload(): Promise<void> {
    loading.value = true;
    try {
      const res = await fetchWithTimeout("/api/tmux/sessions", undefined, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`GET /api/tmux/sessions → ${res.status}`);
      const body = await jsonBody(res);
      // A malformed row is dropped rather than asserted: the alternative is a stop button whose
      // key is undefined, posting to `/api/session/undefined/terminate`.
      sessions.value = isUnknownArray(body.sessions) ? body.sessions.filter(isSurvivingSession) : [];
      armedIntervalHours.value = sanitizeReapIntervalHours(body.armedReapIntervalHours);
      failed.value = false;
    } catch (err) {
      console.warn("[surviving-sessions] could not read the list:", err);
      sessions.value = [];
      armedIntervalHours.value = REAP_INTERVAL_HOURS_OFF;
      failed.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { sessions, armedIntervalHours, loading, failed, reload };
}
