import { ref } from "vue";

// The /api/cost payload: estimated $ spend for the current session plus today /
// month roll-ups. `session` is absent when no session id was requested.
export interface CostRollup {
  session?: number;
  today: number;
  month: number;
  currency: string;
  unpricedTurns: number;
}

const COST_FETCH_TIMEOUT_MS = 8000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finiteNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseCost(data: unknown): CostRollup | null {
  if (!isRecord(data)) return null;
  return {
    session: finiteNumber(data.session),
    today: finiteNumber(data.today) ?? 0,
    month: finiteNumber(data.month) ?? 0,
    currency: typeof data.currency === "string" ? data.currency : "USD",
    unpricedTurns: finiteNumber(data.unpricedTurns) ?? 0,
  };
}

// Fetch estimated cost for a project (and optional session). Errors — including a
// timeout — leave `cost` null and set `error`, so the caller can show a fallback.
export function useCost() {
  const cost = ref<CostRollup | null>(null);
  const loading = ref(false);
  const error = ref(false);

  async function load(cwd?: string | null, sessionId?: string | null): Promise<void> {
    loading.value = true;
    error.value = false;
    const params = new URLSearchParams();
    if (cwd) params.set("cwd", cwd);
    if (sessionId) params.set("session", sessionId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COST_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/cost?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`cost request failed: ${res.status}`);
      cost.value = parseCost(await res.json());
    } catch {
      error.value = true;
    } finally {
      clearTimeout(timer);
      loading.value = false;
    }
  }

  return { cost, loading, error, load };
}
