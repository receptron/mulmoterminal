import { ref, type Ref } from "vue";
import { presetLabel, type CwdPreset } from "../components/presets";
import type { Launcher } from "../components/launchers";
import type { UserMcpServer } from "../components/userMcp";

// The custom attention-sound file is a SINGLETON ref shared across every
// useAppConfig() caller — the beep player lives in the single view while the
// settings modal can be opened from either view, so a change in one must reach the
// other (each useAppConfig() otherwise has its own local refs).
const soundFile = ref<string | null>(null);

// Cross-repo PR list's repos — also a SINGLETON, so the settings modal (openable from
// either view) and any future reader share one list; a save in one view is seen by the
// other instead of each useAppConfig() keeping a divergent copy.
const prRepos = ref<string[]>([]);

// Cell-launcher commands (shell/codex/…) — SINGLETON so the grid's cell launchers and
// the settings editor (openable from either view) share one list.
const launchers = ref<Launcher[]>([]);

// User-added HTTP MCP servers merged into the single-view session's --mcp-config —
// SINGLETON like the others.
const userMcpServers = ref<UserMcpServer[]>([]);

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

// POST a single config field as a partial update; the server keeps the other fields, so
// this never clobbers them. Returns the server's echoed value for that field (or
// `{ ok: false }` on failure) so each caller can update just its own singleton ref.
async function postConfigField<T>(field: string, value: unknown): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const res = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    if (!res.ok) return { ok: false };
    const body: Record<string, unknown> = await res.json();
    return { ok: true, value: body[field] as T };
  } catch {
    return { ok: false };
  }
}

// The record/remove/migrate preset mutations. Each preset write POSTs the whole array, so
// concurrent record/remove calls (two grid cells launching at once) must not each derive
// `next` from the same stale snapshot — the later POST would clobber the earlier one
// (last-write-wins, dropping a just-launched dir). `serialize` runs the writes in order so
// every mutation reads the freshly-saved list before computing its own.
function createPresetMutations(presets: Ref<CwdPreset[]>, savePresets: (next: CwdPreset[]) => Promise<boolean>) {
  let presetWrite: Promise<unknown> = Promise.resolve();
  function serialize(mutate: () => Promise<void>): Promise<void> {
    const run = presetWrite.then(mutate, mutate);
    presetWrite = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // Auto-add the dir the user just launched in, so it becomes a one-click chip, and move it
  // to the FRONT (most-recently-used) on every launch so the list reflects launch order. A
  // re-launched dir keeps its existing (possibly manual) label; a new dir is prepended with
  // its basename. Already at the front → no write. No cap: the user prunes the list with the
  // chip's ✕. Called with the server-confirmed (effective) cwd so we only remember dirs that
  // actually ran.
  function recordPreset(path: string | null): Promise<void> {
    if (!path) return Promise.resolve();
    return serialize(async () => {
      if (presets.value[0]?.path === path) return; // already most-recent — nothing to reorder
      const existing = presets.value.find((p) => p.path === path);
      const entry = existing ?? { label: presetLabel(path), path };
      await savePresets([entry, ...presets.value.filter((p) => p.path !== path)]);
    });
  }

  // Drop one preset (the chip's ✕). No-op when the path isn't present.
  function removePreset(path: string): Promise<void> {
    return serialize(async () => {
      if (!presets.value.some((p) => p.path === path)) return;
      await savePresets(presets.value.filter((p) => p.path !== path));
    });
  }

  // One-time import of the pre-#163 localStorage recents so upgrading users keep their recent
  // dirs as chips. New paths are prepended (most-recent first) so the last-used dir stays at
  // the front — consistent with the MRU ordering; their basename is the label. The legacy key
  // is cleared on success so a chip the user later deletes can't reappear. Dedup keeps it
  // harmless if it runs twice.
  async function migrateLegacyRecents(): Promise<void> {
    const legacy = readLegacyRecents();
    if (!legacy.length) return;
    const known = new Set(presets.value.map((p) => p.path));
    const additions = legacy.filter((path) => !known.has(path)).map((path) => ({ label: presetLabel(path), path }));
    let saved = true;
    if (additions.length) {
      await serialize(async () => {
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

  return { recordPreset, removePreset, migrateLegacyRecents };
}

// The directory-preset subsystem: savePresets + the mutations above, owning the version
// coordination with loadConfig. `version` is bumped by every local preset write; loadConfig
// captures it (snapshotVersion) before its GET and adoptServerPresets skips the server list
// if it changed meanwhile — else a dir the user launched before the initial /api/config
// resolves would be dropped by the stale GET.
function createPresetManager(presets: Ref<CwdPreset[]>, saving: Ref<boolean>, error: Ref<string | null>) {
  let version = 0;

  // Persist the directory presets. Posts only cwdPresets — the server keeps the other fields,
  // so this never clobbers them. Returns whether the save succeeded.
  async function savePresets(next: CwdPreset[]): Promise<boolean> {
    saving.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwdPresets: next }) });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      presets.value = (await res.json()).cwdPresets ?? [];
      version++;
      return true;
    } catch {
      error.value = "Couldn't save presets. Check the server and try again.";
      return false;
    } finally {
      saving.value = false;
    }
  }

  const snapshotVersion = (): number => version;
  const adoptServerPresets = (list: unknown, capturedVersion: number): void => {
    if (version === capturedVersion) presets.value = Array.isArray(list) ? list : [];
  };

  return { savePresets, ...createPresetMutations(presets, savePresets), snapshotVersion, adoptServerPresets };
}

// The single-field savers each persist ONE config field and update its SINGLETON ref, so
// they're module-level (no per-composable state) — useAppConfig just re-exports them.
// Persist just the custom attention sound (a file path, or null to use the chime).
async function saveSound(file: string | null): Promise<boolean> {
  const r = await postConfigField<unknown>("soundFile", file);
  if (r.ok) soundFile.value = typeof r.value === "string" ? r.value : null;
  return r.ok;
}
// Persist the cross-repo PR list's repos (partial update, other fields untouched).
async function savePrRepos(next: string[]): Promise<boolean> {
  const r = await postConfigField<string[]>("prRepos", next);
  if (r.ok) prRepos.value = r.value ?? [];
  return r.ok;
}
// Persist the cell-launcher commands (partial update).
async function saveLaunchers(next: Launcher[]): Promise<boolean> {
  const r = await postConfigField<Launcher[]>("launchers", next);
  if (r.ok) launchers.value = r.value ?? [];
  return r.ok;
}
// Persist the user MCP servers (partial update).
async function saveUserMcpServers(next: UserMcpServer[]): Promise<boolean> {
  const r = await postConfigField<UserMcpServer[]>("userMcpServers", next);
  if (r.ok) userMcpServers.value = r.value ?? [];
  return r.ok;
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

  const { savePresets, recordPreset, removePreset, migrateLegacyRecents, snapshotVersion, adoptServerPresets } = createPresetManager(presets, saving, error);

  async function loadConfig() {
    const version = snapshotVersion();
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const c = await res.json();
      defaultCwd.value = c.cwd ?? null;
      home.value = c.home ?? null;
      adoptServerPresets(c.cwdPresets, version);
      soundFile.value = typeof c.soundFile === "string" ? c.soundFile : null;
      prRepos.value = Array.isArray(c.prRepos) ? c.prRepos : [];
      launchers.value = Array.isArray(c.launchers) ? c.launchers : [];
      userMcpServers.value = Array.isArray(c.userMcpServers) ? c.userMcpServers : [];
      await migrateLegacyRecents();
    } catch {
      // the app still works; presets are just unavailable
    }
  }

  return {
    defaultCwd,
    home,
    presets,
    prRepos,
    launchers,
    userMcpServers,
    soundFile,
    saving,
    error,
    loadConfig,
    savePresets,
    recordPreset,
    removePreset,
    saveSound,
    savePrRepos,
    saveLaunchers,
    saveUserMcpServers,
  };
}
