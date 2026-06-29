import { ref } from "vue";

// Recently used working directories, persisted in localStorage so the cell
// launcher can offer the user's last few folders as quick-pick chips (separate
// from the manually-curated presets in config.json). Most-recent-first.
//
// The ref is a module-scoped SINGLETON so every launcher cell shares one list:
// launching in one cell records the dir and the chip appears in all the others.

const STORAGE_KEY = "recent_dirs_v1";
const MAX_RECENTS = 4;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === "string" && d.length > 0).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

const recentDirs = ref<string[]>(load());

export function useRecentDirs() {
  // Push `dir` to the front, dedup, cap the list, and persist. Called with the
  // server-confirmed (effective) cwd so we only remember dirs that actually ran.
  function recordDir(dir: string | null) {
    if (!dir) return;
    const next = [dir, ...recentDirs.value.filter((d) => d !== dir)].slice(0, MAX_RECENTS);
    recentDirs.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort — recents are a convenience, not load-bearing
    }
  }

  return { recentDirs, recordDir };
}
