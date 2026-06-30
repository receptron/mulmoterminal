import { ref } from "vue";
import { presetLabel, type CwdPreset } from "../components/presets";

// The custom attention-sound file is a SINGLETON ref shared across every
// useAppConfig() caller — the beep player lives in the single view while the
// settings modal can be opened from either view, so a change in one must reach the
// other (each useAppConfig() otherwise has its own local refs).
const soundFile = ref<string | null>(null);

// Server config (default workspace dir, home, directory presets, custom sound)
// shared by both the single view and the grid view so each can open the settings
// modal without duplicating the fetch/save logic.
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
      soundFile.value = typeof c.soundFile === "string" ? c.soundFile : null;
    } catch {
      // the app still works; presets are just unavailable
    }
  }

  // Persist the directory presets. Posts only cwdPresets — the server keeps the
  // other fields (the sound), so this never clobbers it. Returns whether the save
  // succeeded.
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

  // Auto-add the dir the user just launched in, so it becomes a one-click chip.
  // Dedup by path (an existing entry keeps its position — no reshuffle on reuse);
  // a new dir is prepended. No cap: the user prunes the list with the chip's ✕.
  // Called with the server-confirmed (effective) cwd so we only remember dirs that
  // actually ran.
  async function recordPreset(path: string | null): Promise<void> {
    if (!path || presets.value.some((p) => p.path === path)) return;
    await savePresets([{ label: presetLabel(path), path }, ...presets.value]);
  }

  // Drop one preset (the chip's ✕). No-op when the path isn't present.
  async function removePreset(path: string): Promise<void> {
    if (!presets.value.some((p) => p.path === path)) return;
    await savePresets(presets.value.filter((p) => p.path !== path));
  }

  // Persist just the custom attention sound (a file path, or null to use the chime).
  // Applied immediately (like the theme), independent of the presets Save button.
  async function saveSound(file: string | null): Promise<boolean> {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ soundFile: file }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const c = await res.json();
      soundFile.value = typeof c.soundFile === "string" ? c.soundFile : null;
      return true;
    } catch {
      return false;
    }
  }

  return { defaultCwd, home, presets, soundFile, saving, error, loadConfig, savePresets, recordPreset, removePreset, saveSound };
}
