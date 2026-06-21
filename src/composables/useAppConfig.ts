import { ref } from "vue";
import type { CwdPreset } from "../components/presets";

// Server config (default workspace dir, home, directory presets) shared by both
// the single view and the grid view so each can open the settings modal without
// duplicating the fetch/save logic.
export function useAppConfig() {
  const defaultCwd = ref<string | null>(null);
  const home = ref<string | null>(null);
  const presets = ref<CwdPreset[]>([]);
  const saving = ref(false);
  const error = ref<string | null>(null);

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const c = await res.json();
      defaultCwd.value = c.cwd ?? null;
      home.value = c.home ?? null;
      presets.value = Array.isArray(c.cwdPresets) ? c.cwdPresets : [];
    } catch {
      // the app still works; presets are just unavailable
    }
  }

  // Returns whether the save succeeded so the caller can close the modal only on
  // success (and keep the user's edits otherwise).
  async function savePresets(next: CwdPreset[]): Promise<boolean> {
    saving.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwdPresets: next }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      presets.value = (await res.json()).cwdPresets ?? [];
      return true;
    } catch {
      error.value = "Couldn't save presets. Check the server and try again.";
      return false;
    } finally {
      saving.value = false;
    }
  }

  return { defaultCwd, home, presets, saving, error, loadConfig, savePresets };
}
