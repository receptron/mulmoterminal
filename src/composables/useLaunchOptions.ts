// The backends this server can launch a session on, for the launch picker (#584).
//
// Fetched once and shared: a full grid mounts a dozen empty cells at the same moment, and
// each one wants the same list. The answer only changes when the user edits config.json or
// restarts the server with a different environment, so `reloadLaunchOptions` is there for
// the settings screen rather than a poll.
import { ref } from "vue";
import type { ModelPreset } from "../../common/modelPresets";

export interface LaunchProviderOption {
  id: string;
  label: string;
  ready: boolean;
  reason?: string;
  tokenEnv: string;
  models: ModelPreset[];
}

export interface LaunchOptions {
  providers: LaunchProviderOption[];
  anyReady: boolean;
}

const EMPTY: LaunchOptions = { providers: [], anyReady: false };
const FETCH_TIMEOUT_MS = 8000;

const options = ref<LaunchOptions>(EMPTY);
let inFlight: Promise<void> | null = null;

async function fetchOptions(): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/launch-options", { signal: abort.signal });
    if (!res.ok) throw new Error(`GET /api/launch-options → ${res.status}`);
    options.value = await res.json();
  } catch (err) {
    // A picker that cannot load its list is not an error the user can act on — the launch
    // form still works and starts the session on the directory's own default.
    console.warn("[launch-options] falling back to the directory default:", err);
    options.value = EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

export function reloadLaunchOptions(): Promise<void> {
  inFlight = fetchOptions();
  return inFlight;
}

export function useLaunchOptions() {
  inFlight ??= fetchOptions();
  return { launchOptions: options };
}
