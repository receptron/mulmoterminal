import { ref } from "vue";
import { presetLabel, type CwdPreset } from "../components/presets";

// The custom attention-sound file is a SINGLETON ref shared across every
// useAppConfig() caller — the beep player lives in the single view while the
// settings modal can be opened from either view, so a change in one must reach the
// other (each useAppConfig() otherwise has its own local refs).
const soundFile = ref<string | null>(null);

// Pre-#163 recent dirs lived in localStorage (the removed useRecentDirs). They are
// imported once into the server-side preset list on load — see migrateLegacyRecents.
const LEGACY_RECENTS_KEY = "recent_dirs_v1";

function readLegacyRecents(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string" && d.length > 0) : [];
  } catch {
    return [];
  }
}

// Server config (default workspace dir, home, directory presets, custom sound)
// shared by both the single view and the grid view so each can open the settings
// modal without duplicating the fetch/save logic.
export function useAppConfig() {
  const defaultCwd = ref<string | null>(null);
  const home = ref<string | null>(null);
  const presets = ref<CwdPreset[]>([]);
  const saving = ref(false);
  const error = ref<string | null>(null);
  // Bumped by every local preset write (savePresets). loadConfig captures it before
  // its GET and skips adopting the server list if it changed meanwhile — otherwise a
  // dir the user launched before the initial /api/config resolves would be dropped by
  // the slower, stale GET snapshot.
  let presetsVersion = 0;

  async function loadConfig() {
    const version = presetsVersion;
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const c = await res.json();
      defaultCwd.value = c.cwd ?? null;
      home.value = c.home ?? null;
      if (presetsVersion === version) presets.value = Array.isArray(c.cwdPresets) ? c.cwdPresets : [];
      soundFile.value = typeof c.soundFile === "string" ? c.soundFile : null;
      await migrateLegacyRecents();
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
      presetsVersion++; // mark local state as newer than any in-flight loadConfig GET
      return true;
    } catch {
      error.value = "Couldn't save presets. Check the server and try again.";
      return false;
    } finally {
      saving.value = false;
    }
  }

  // Each preset write POSTs the whole array, so concurrent record/remove calls
  // (two grid cells launching at once) must not each derive `next` from the same
  // stale snapshot — the later POST would clobber the earlier one (last-write-wins,
  // dropping a just-launched dir). Serialize the writes so every mutation reads the
  // freshly-saved list before computing its own.
  let presetWrite: Promise<unknown> = Promise.resolve();
  function serializePresetWrite(mutate: () => Promise<void>): Promise<void> {
    const run = presetWrite.then(mutate, mutate);
    presetWrite = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // Auto-add the dir the user just launched in, so it becomes a one-click chip, and
  // move it to the FRONT (most-recently-used) on every launch so the list reflects
  // launch order. A re-launched dir keeps its existing (possibly manual) label; a new
  // dir is prepended with its basename. Already at the front → no write. No cap: the
  // user prunes the list with the chip's ✕. Called with the server-confirmed
  // (effective) cwd so we only remember dirs that actually ran.
  function recordPreset(path: string | null): Promise<void> {
    if (!path) return Promise.resolve();
    return serializePresetWrite(async () => {
      if (presets.value[0]?.path === path) return; // already most-recent — nothing to reorder
      const existing = presets.value.find((p) => p.path === path);
      const entry = existing ?? { label: presetLabel(path), path };
      await savePresets([entry, ...presets.value.filter((p) => p.path !== path)]);
    });
  }

  // Drop one preset (the chip's ✕). No-op when the path isn't present.
  function removePreset(path: string): Promise<void> {
    return serializePresetWrite(async () => {
      if (!presets.value.some((p) => p.path === path)) return;
      await savePresets(presets.value.filter((p) => p.path !== path));
    });
  }

  // One-time import of the pre-#163 localStorage recents so upgrading users keep
  // their recent dirs as chips. New paths are prepended (most-recent first, ahead of
  // the existing presets) so the last-used dir stays at the front — consistent with
  // the MRU ordering; their basename is the label. The legacy key is cleared on
  // success so a chip the user later deletes can't reappear. Dedup keeps it harmless
  // if it runs twice.
  async function migrateLegacyRecents(): Promise<void> {
    const legacy = readLegacyRecents();
    if (!legacy.length) return;
    const known = new Set(presets.value.map((p) => p.path));
    const additions = legacy.filter((path) => !known.has(path)).map((path) => ({ label: presetLabel(path), path }));
    let saved = true;
    if (additions.length) {
      await serializePresetWrite(async () => {
        saved = await savePresets([...additions, ...presets.value]);
      });
    }
    if (!saved) return; // keep the key so the import retries on the next load
    try {
      localStorage.removeItem(LEGACY_RECENTS_KEY);
    } catch {
      // storage blocked — dedup makes a retry harmless
    }
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
