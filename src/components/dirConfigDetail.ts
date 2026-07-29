import { isRecord } from "../../common/isRecord";
import { EMPTY_DIR_CONFIG_SOURCE, type DirConfigSource } from "../../common/dirConfigSource";
import { presetLabel } from "./presets";

// The settings modal's read-only view of one directory's `.mulmoterminal.json`, built off
// /api/dir-config-detail. Kept out of the component so the wire parsing and the wording of
// every row can be tested without mounting anything.

export interface DirConfigRow {
  key: string;
  label: string;
  // What the app resolved, as text. A colour row shows its hex here too — the swatch is a
  // second reading of the same value, not a replacement for it.
  value: string;
  // Set only for a row whose value IS a colour, so the component knows to draw a swatch.
  color: string | null;
}

export interface DirConfigDetailView {
  // False when the directory itself is gone — a preset outliving its project. Distinct from
  // "no config file here", which describes a directory that is fine.
  exists: boolean;
  file: string | null;
  rows: DirConfigRow[];
  source: DirConfigSource;
}

// The preview lists directories BY NAME, not in the recent-first order the launch chips use.
// Those are different jobs: the chips answer "where was I working", this one is a reference you
// scan for a directory you already have in mind, and a list that reorders itself as you work is
// the wrong shape for that. `numeric` keeps proj2 above proj10; the path breaks ties, since two
// checkouts of the same repo share a basename.
export function sortDirPathsByName(paths: readonly string[]): string[] {
  const byName = (a: string, b: string) => presetLabel(a).localeCompare(presetLabel(b), undefined, { sensitivity: "base", numeric: true });
  return [...paths].sort((a, b) => byName(a, b) || a.localeCompare(b));
}

// Ordered as the settings read, not as the type declares: what the directory is called, then
// the colours in the order the eye meets them, then the terminal's own settings.
const COLOR_FIELDS: [key: string, label: string][] = [
  ["headerColor", "Header background"],
  ["headerTextColor", "Header text"],
  ["badgeColor", "Name badge"],
  ["cellColor", "Cell background"],
  ["cellBorderColor", "Cell border"],
  ["dotColor", "Status dot"],
  ["buttonColor", "Header buttons"],
];

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function colorRows(config: Record<string, unknown>): DirConfigRow[] {
  return COLOR_FIELDS.flatMap(([key, label]) => {
    const color = asString(config[key]);
    return color ? [{ key, label, value: color, color }] : [];
  });
}

function terminalRows(config: Record<string, unknown>): DirConfigRow[] {
  const rows: DirConfigRow[] = [];
  const theme = asString(config.theme);
  if (theme) rows.push({ key: "theme", label: "Terminal theme", value: theme, color: null });
  // The palette is a map of xterm colour keys; the count is the useful summary, since the
  // individual entries are the terminal's own business rather than the chrome's.
  const palette = isRecord(config.colors) ? Object.keys(config.colors).length : 0;
  if (palette) rows.push({ key: "colors", label: "Palette overrides", value: `${palette} colour${palette === 1 ? "" : "s"}`, color: null });
  const fontSize = asNumber(config.fontSize);
  if (fontSize) rows.push({ key: "fontSize", label: "Font size", value: `${fontSize}px`, color: null });
  const fontFamily = asString(config.fontFamily);
  if (fontFamily) rows.push({ key: "fontFamily", label: "Font family", value: fontFamily, color: null });
  const priority = asNumber(config.orderPriority);
  if (priority !== null) rows.push({ key: "orderPriority", label: "Grid priority", value: String(priority), color: null });
  if (config.hasSound === true) rows.push({ key: "sound", label: "Attention sound", value: "configured", color: null });
  return rows;
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

// The settings a running terminal has no use for, which therefore aren't in the per-cell
// config: what the sessions here run on, and what they may reach. Named rather than counted —
// "provider: openrouter" is the answer someone came to this screen for.
function extraRows(extras: Record<string, unknown>): DirConfigRow[] {
  const rows: DirConfigRow[] = [];
  const provider = asString(extras.provider);
  if (provider) rows.push({ key: "provider", label: "Provider", value: provider, color: null });
  const model = asString(extras.model);
  if (model) rows.push({ key: "model", label: "Model", value: model, color: null });
  const skills = stringList(extras.skills);
  if (skills.length) rows.push({ key: "skills", label: "Skill menu", value: skills.join(", "), color: null });
  const addDirs = stringList(extras.addDirs);
  if (addDirs.length) rows.push({ key: "addDirs", label: "Extra directories", value: addDirs.join(", "), color: null });
  // Both booleans are a setting, so the test is the TYPE, not truthiness — `false` is the whole
  // reason someone opens this panel for this key, and a falsy check would hide exactly that.
  if (typeof extras.appendSystemPrompt === "boolean") {
    rows.push({ key: "appendSystemPrompt", label: "Closing summary", value: extras.appendSystemPrompt ? "on" : "off", color: null });
  }
  const buttons = stringList(extras.buttonLabels);
  if (buttons.length) rows.push({ key: "buttons", label: "Header buttons", value: buttons.join(", "), color: null });
  const chips = stringList(extras.chipLabels);
  if (chips.length) rows.push({ key: "chips", label: "Header chips", value: chips.join(", "), color: null });
  return rows;
}

// Every row here comes from ONE directory's own file — the server resolves `.mulmoterminal.json`
// alone, with no global config or defaults merged in. That is what makes the file path shown
// above the table the provenance of every value under it.
export function dirConfigRows(config: unknown, extras: unknown = {}): DirConfigRow[] {
  if (!isRecord(config)) return isRecord(extras) ? extraRows(extras) : [];
  const name = asString(config.name);
  return [
    ...(name ? [{ key: "name", label: "Name", value: name, color: null }] : []),
    ...colorRows(config),
    ...terminalRows(config),
    ...(isRecord(extras) ? extraRows(extras) : []),
  ];
}

export function parseDirConfigDetail(data: unknown): DirConfigDetailView {
  if (!isRecord(data)) return { exists: false, file: null, rows: [], source: EMPTY_DIR_CONFIG_SOURCE };
  const source = isRecord(data.source) ? data.source : {};
  return {
    // Absent on the wire is read as "gone" rather than "fine": the only responses without it
    // are the ones this parser already couldn't make sense of.
    exists: data.exists === true,
    file: asString(data.file),
    rows: dirConfigRows(data.config, data.extras),
    source: { applied: stringList(source.applied), ignored: stringList(source.ignored), unknown: stringList(source.unknown) },
  };
}
