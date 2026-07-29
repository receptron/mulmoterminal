// Where a directory's settings actually came from, for the settings modal's preview.
//
// The rest of the app only ever needs the RESOLVED config — the values a terminal adopts.
// That is exactly what makes a mistyped or rejected setting invisible: the file is on disk,
// the app reads it, and the value silently isn't there. This says which keys the file set,
// which of them survived validation, and which the app doesn't read at all.

// Every key `loadDirConfig` reads. A key outside this list is a typo as far as the app is
// concerned, however sensible it looks — `server/config/dir-config.spec.ts` pins the two
// together so a field added to the loader can't quietly go missing here.
export const DIR_CONFIG_KEYS = [
  "name",
  "badgeColor",
  "headerColor",
  "headerTextColor",
  "cellColor",
  "cellBorderColor",
  "dotColor",
  "buttonColor",
  "fontSize",
  "fontFamily",
  "orderPriority",
  "theme",
  "colors",
  "sound",
  "sounds",
  "buttons",
  "chips",
  "skills",
  "provider",
  "model",
  "addDirs",
  "appendSystemPrompt",
] as const;

export interface DirConfigSource {
  // Keys the file set that the app is using.
  applied: string[];
  // Keys the file set that the app read and then dropped — an out-of-range number, a colour
  // that isn't #rrggbb, a sound outside the directory. The value is gone; the key is the clue.
  ignored: string[];
  // Keys the app doesn't read at all: a misspelling (`badgeColour`), or a setting that belongs
  // in the global config instead of a directory's file.
  unknown: string[];
}

export const EMPTY_DIR_CONFIG_SOURCE: DirConfigSource = { applied: [], ignored: [], unknown: [] };

// The settings a directory can make that the per-cell config deliberately doesn't carry — the
// browser has no use for them while running a terminal, but the preview has to SHOW them or a
// key like `provider` can only be named as applied, never read back.
//
// Labels only for buttons and chips: their `cmd` / `text` is what the button would type into
// the session, which is not what "did my config take effect" needs, and is the sort of thing a
// screenshot of the settings screen shouldn't carry. Sound paths stay out for the same reason
// they stay out of the per-cell config — that path is the confinement boundary.
export interface DirConfigExtras {
  provider: string | null;
  model: string | null;
  skills: string[] | null;
  addDirs: string[] | null;
  // Tri-state on purpose: `false` is a setting this file made, and the preview has to show it as
  // one. Carried here because a boolean cannot be read back off the per-cell config the way a
  // colour can — without it the panel reports the file as setting nothing at all.
  appendSystemPrompt: boolean | null;
  buttonLabels: string[];
  chipLabels: string[];
}

export const EMPTY_DIR_CONFIG_EXTRAS: DirConfigExtras = {
  provider: null,
  model: null,
  skills: null,
  addDirs: null,
  appendSystemPrompt: null,
  buttonLabels: [],
  chipLabels: [],
};

// "The loader kept nothing for this key" — null/undefined, but also the empty collections the
// loader returns when every entry in a map or list was rejected.
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

// The keys a resolved config actually holds a value for. Taken as a SET by describeDirConfig
// rather than the config object itself: the loader's type is an interface with named fields,
// which no amount of `Record<string, unknown>` will accept without a cast.
export function keysWithValue(resolved: object): Set<string> {
  const entries: [string, unknown][] = Object.entries(resolved);
  return new Set(entries.filter(([, value]) => !isEmptyValue(value)).map(([key]) => key));
}

// `raw` is the file as parsed; `kept` is which keys survived the loader (see keysWithValue).
export function describeDirConfig(raw: Record<string, unknown>, kept: ReadonlySet<string>): DirConfigSource {
  const known = new Set<string>(DIR_CONFIG_KEYS);
  const source: DirConfigSource = { applied: [], ignored: [], unknown: [] };
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) source.unknown.push(key);
    else if (kept.has(key)) source.applied.push(key);
    else source.ignored.push(key);
  }
  return source;
}
