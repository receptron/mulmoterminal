// Which file a value handed to manageJingleScript's `files.byPath` names, decided without
// touching the disk.
//
// @gui-chat-plugin/jinglescript 1.5 hands the host two kinds of value:
//   - its own render / compose files, always `jinglescript/<name>` (renderScore's audio and
//     timing map, composeScore's score and ABC). These are CREATED, and they live under the
//     calling session's directory, so an agent finds them relative to where it runs.
//   - a score the model named by `path` (checkScore / renderScore), any `.json` on disk, read
//     exactly as presentDocument reads a document: relative to the session, never created.
import { sessionRelativePath } from "./sessionRelativePath.js";

/** The score files a call may name by `path`. Declared here rather than imported: the package
 *  checks the same `.json` rule itself but does not export it. */
export const JINGLESCRIPT_SCORE_EXTENSIONS = [".json"] as const;

/** The folder, under the session's directory, the plugin keeps its files in. */
export const JINGLESCRIPT_FILES_DIR = "jinglescript";

/** What the plugin writes there: scores and their timing maps, ABC, and audio. */
export const JINGLESCRIPT_FILE_EXTENSIONS = [".json", ".abc", ".mp3", ".wav"] as const;

// The plugin's file stem (`[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}`) plus "-1000" and ".timing.json"
// stays well under this; it bounds a name nothing in the plugin would produce.
const MAX_FILE_NAME_LENGTH = 128;

// One plain segment that cannot be `.`, `..` or a dotfile: no separator, no leading dot.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export type JingleScriptFileTarget = { area: "files"; name: string } | { area: "score"; value: string };

function filesAreaName(value: string): string | null {
  const prefix = `${JINGLESCRIPT_FILES_DIR}/`;
  if (!value.startsWith(prefix)) return null;
  const name = value.slice(prefix.length);
  if (name.length > MAX_FILE_NAME_LENGTH || !FILE_NAME.test(name)) return null;
  const lower = name.toLowerCase();
  return JINGLESCRIPT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length) ? name : null;
}

/**
 * Where `value` goes, or null when it names nothing this tool may touch.
 *
 * `files`: `name` inside `<cwd>/jinglescript/`. `score`: a path for the score ops — made
 * absolute against `cwd` when it was relative, untouched otherwise, with their own `.json`
 * gate still to pass. A `jinglescript/…` value that is not a plain file name of the area
 * (nested, a dotfile, another extension) is NOT promoted to the area; a `.json` one still
 * reads as a score, as it did before the area existed.
 */
export function jingleScriptFileTarget(value: unknown, cwd: string): JingleScriptFileTarget | null {
  if (typeof value !== "string" || value === "" || value.includes("\0")) return null;
  const name = filesAreaName(value);
  if (name !== null) return { area: "files", name };
  if (!JINGLESCRIPT_SCORE_EXTENSIONS.some((ext) => value.toLowerCase().endsWith(ext))) return null;
  return { area: "score", value: sessionRelativePath(value, cwd, JINGLESCRIPT_SCORE_EXTENSIONS) };
}
