import { ref, watch, onScopeDispose, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import type { ITheme } from "@xterm/xterm";
import { isThemeId, type ThemeId } from "./useTheme";

// The per-directory overrides a terminal adopts when its cwd holds a
// `.mulmoterminal.json` (served by GET /api/dir-config). The raw sound path stays
// server-side; `hasSound` says whether GET /api/dir-sound has something to stream.
export interface DirConfig {
  name: string | null;
  badgeColor: string | null;
  // The cell header's own background / text color (grid cell + single view), or null
  // to keep the theme default. Distinct from `colors` (the xterm palette).
  headerColor: string | null;
  headerTextColor: string | null;
  // The cell frame + accents (body background, border, idle status dot, header buttons).
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
  theme: ThemeId | null;
  // Per-key xterm palette overrides applied on top of `theme` (or the app theme).
  colors: Partial<ITheme> | null;
  hasSound: boolean;
}

const EMPTY: DirConfig = {
  name: null,
  badgeColor: null,
  headerColor: null,
  headerTextColor: null,
  cellColor: null,
  cellBorderColor: null,
  dotColor: null,
  buttonColor: null,
  theme: null,
  colors: null,
  hasSound: false,
};

// The ITheme keys a dir may override; values arrive server-sanitized but are
// re-checked here so a hand-rolled response can't widen the terminal options.
const THEME_COLOR_KEYS = [
  "foreground",
  "background",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

function parseColors(input: unknown): Partial<ITheme> | null {
  if (!isRecord(input)) return null;
  const out: Partial<ITheme> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = input[key];
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// One fetch per cwd, shared across cells: several terminals in the same directory
// resolve to one request. Invalidated by the `dir-config` channel, which the server
// publishes when a tool hook reports a write to that dir's .mulmoterminal.json — so a
// config change recolours the cells live, with no filesystem watchers.
const cache = new Map<string, Promise<DirConfig>>();

// Live `config` refs, keyed by the cwd they're bound to, so an invalidation reaches
// every cell showing that directory.
const bound = new Map<string, Set<(config: DirConfig) => void>>();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(c: unknown): DirConfig {
  if (!isRecord(c)) return EMPTY;
  return {
    name: typeof c.name === "string" ? c.name : null,
    badgeColor: typeof c.badgeColor === "string" ? c.badgeColor : null,
    headerColor: typeof c.headerColor === "string" ? c.headerColor : null,
    headerTextColor: typeof c.headerTextColor === "string" ? c.headerTextColor : null,
    cellColor: typeof c.cellColor === "string" ? c.cellColor : null,
    cellBorderColor: typeof c.cellBorderColor === "string" ? c.cellBorderColor : null,
    dotColor: typeof c.dotColor === "string" ? c.dotColor : null,
    buttonColor: typeof c.buttonColor === "string" ? c.buttonColor : null,
    theme: isThemeId(c.theme) ? c.theme : null,
    colors: parseColors(c.colors),
    hasSound: c.hasSound === true,
  };
}

export function fetchDirConfig(cwd: string): Promise<DirConfig> {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await fetch(`/api/dir-config?cwd=${encodeURIComponent(cwd)}`);
      return res.ok ? parse(await res.json()) : EMPTY;
    } catch {
      return EMPTY;
    }
  })();
  cache.set(cwd, pending);
  return pending;
}

// Reactive dir config for a (possibly changing) cwd. Resets to empty while no cwd is
/** Drop `cwd`'s cached config, re-read it, and push the result into every cell showing that dir. */
export function invalidateDirConfig(cwd: string): void {
  cache.delete(cwd);
  const targets = bound.get(cwd);
  if (!targets?.size) return;
  fetchDirConfig(cwd).then((config) => targets.forEach((apply) => apply(config)));
}

// One process-wide subscription, established by the first cell that asks for a dir config.
let subscribed = false;
function subscribeToDirConfigChanges(): void {
  if (subscribed) return;
  subscribed = true;
  usePubSub().subscribe("dir-config", (data) => {
    if (isRecord(data) && typeof data.cwd === "string") invalidateDirConfig(data.cwd);
  });
}

// set so a cell that switches directories never shows a stale badge/theme.
export function useDirConfig(cwd: Ref<string | null | undefined>) {
  const config = ref<DirConfig>(EMPTY);
  subscribeToDirConfigChanges();

  let boundCwd: string | null = null;
  const apply = (next: DirConfig) => (config.value = next);
  const unbind = () => {
    if (boundCwd) bound.get(boundCwd)?.delete(apply);
    boundCwd = null;
  };

  watch(
    cwd,
    async (c) => {
      unbind();
      if (!c) {
        config.value = EMPTY;
        return;
      }
      let targets = bound.get(c);
      if (!targets) {
        targets = new Set();
        bound.set(c, targets);
      }
      targets.add(apply);
      boundCwd = c;
      const resolved = await fetchDirConfig(c);
      if (cwd.value === c) config.value = resolved; // ignore a stale resolve after a fast switch
    },
    { immediate: true },
  );
  onScopeDispose(unbind); // a closed cell must not keep receiving invalidations
  return { config };
}
