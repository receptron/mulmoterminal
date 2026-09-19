// The two numbers the idle sweep runs on, shown beside the list they govern (Settings → Sessions
// that survived a restart) rather than only in config.json: the sweep is the one behaviour here
// that acts without being asked, and a setting nobody can find is how that becomes a surprise.
//
// Both in one module for the reason `worklog.ts` keeps its switch and its cadence together — a
// reader asking "how often" is always the same reader who just set "after how long".
import { computed, ref, type ComputedRef } from "vue";
import { DEFAULT_REAP_IDLE_DAYS, DEFAULT_REAP_INTERVAL_HOURS, sanitizeReapIdleDays, sanitizeReapIntervalHours } from "../../common/sessionReap";
import { postConfigField } from "./postConfigField";

const idleDays = ref(DEFAULT_REAP_IDLE_DAYS);

export const sessionIdleReapDays: ComputedRef<number> = computed(() => idleDays.value);

export const setSessionIdleReapDays = (value: unknown): void => {
  idleDays.value = sanitizeReapIdleDays(value);
};

export async function saveSessionIdleReapDays(days: number): Promise<boolean> {
  const r = await postConfigField("sessionIdleReapDays", sanitizeReapIdleDays(days));
  if (r.ok) setSessionIdleReapDays(r.value);
  return r.ok;
}

// How often the sweep runs again while the server is up (#2165). Zero is OFF, and off is the
// default — so until someone raises it, the sweep is the boot one only, which is what the row's
// "ends at next start" wording assumes.
const intervalHours = ref(DEFAULT_REAP_INTERVAL_HOURS);

export const sessionReapIntervalHours: ComputedRef<number> = computed(() => intervalHours.value);

export const setSessionReapIntervalHours = (value: unknown): void => {
  intervalHours.value = sanitizeReapIntervalHours(value);
};

export async function saveSessionReapIntervalHours(hours: number): Promise<boolean> {
  const r = await postConfigField("sessionReapIntervalHours", sanitizeReapIntervalHours(hours));
  if (r.ok) setSessionReapIntervalHours(r.value);
  return r.ok;
}
