import { ref, watch, onScopeDispose, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import type { ITheme } from "@xterm/xterm";
import { isThemeId, type ThemeId } from "./useTheme";
// Shared with the server config schema so the two can't drift — see common/themeColors.ts.
import { THEME_COLOR_KEYS } from "../../common/themeColors";
import type { DirChrome } from "../../common/dirChrome";

// The per-directory overrides a terminal adopts when its cwd holds a
// `.mulmoterminal.json` (served by GET /api/dir-config). The raw sound path stays
// server-side; `hasSound` says whether GET /api/dir-sound has something to stream.
export interface DirConfig extends DirChrome {
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

// The last RESOLVED config per cwd. A re-mounted cell (e.g. after a top-tab switch that
// unmounts the grid / single view) seeds `config` from this SYNCHRONOUSLY, so it paints
// the directory's palette on the first frame instead of flashing the default theme until
// the (already-cached) fetch settles a microtask later.
const resolvedConfig = new Map<string, DirConfig>();
const seedConfig = (cwd: string | null | undefined): DirConfig => (cwd ? (resolvedConfig.get(cwd) ?? EMPTY) : EMPTY);

// Live `config` refs, keyed by the cwd they're bound to, so an invalidation reaches
// every cell showing that directory.
const bound = new Map<string, Set<(config: DirConfig) => void>>();

// Per-cwd generation counter. Two writes in quick succession start two overlapping
// requests, and HTTP responses can land out of order — an older one must never
// overwrite a newer config, so a fetch only applies while its generation is current.
const generation = new Map<string, number>();
const generationOf = (cwd: string): number => generation.get(cwd) ?? 0;

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
      const parsed = res.ok ? parse(await res.json()) : EMPTY;
      resolvedConfig.set(cwd, parsed); // remember the value so a re-mount seeds it synchronously
      return parsed;
    } catch {
      return EMPTY; // leave any prior cached value in place — don't record a transient failure
    }
  })();
  cache.set(cwd, pending);
  return pending;
}

// Reactive dir config for a (possibly changing) cwd. Resets to empty while no cwd is
/** Test-only: how many directories currently have a bound cell (must not grow without bound). */
export function boundDirCount(): number {
  return bound.size;
}

/** Drop `cwd`'s cached config, re-read it, and push the result into every cell showing that dir. */
export function invalidateDirConfig(cwd: string): void {
  cache.delete(cwd);
  const targets = bound.get(cwd);
  if (!targets?.size) return;
  const seq = generationOf(cwd) + 1;
  generation.set(cwd, seq);
  fetchDirConfig(cwd).then((config) => {
    if (generationOf(cwd) !== seq) return; // a newer invalidation superseded this response
    targets.forEach((apply) => apply(config));
  });
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
  const config = ref<DirConfig>(seedConfig(cwd.value));
  subscribeToDirConfigChanges();

  let boundCwd: string | null = null;
  const apply = (next: DirConfig) => (config.value = next);
  const unbind = () => {
    if (!boundCwd) return;
    const targets = bound.get(boundCwd);
    if (targets) {
      targets.delete(apply);
      if (!targets.size) {
        // Drop the keys too, or opening many directories grows both maps forever.
        bound.delete(boundCwd);
        generation.delete(boundCwd);
      }
    }
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
      config.value = seedConfig(c); // paint the cached palette now; the fetch below refreshes it
      const seq = generationOf(c);
      const resolved = await fetchDirConfig(c);
      // Ignore a stale resolve after a fast directory switch, or after an invalidation
      // that raced this fetch — its own response is the newer one.
      if (cwd.value === c && generationOf(c) === seq) config.value = resolved;
    },
    { immediate: true },
  );
  onScopeDispose(unbind); // a closed cell must not keep receiving invalidations
  return { config };
}
