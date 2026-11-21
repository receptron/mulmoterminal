// Reading Claude Code's settings files for one directory (#3332) and laying them over each other. Read
// only; which files, in what order and how they merge is settings-layers.ts.
import { promises as fs } from "node:fs";
import { LIBRARY_FILE_TEXT_MAX } from "../../../common/libraryFiles.js";
import { isRecord } from "../../../common/isRecord.js";
import type { LibrarySettings, SettingsFile } from "../../../common/librarySettings.js";
import { localTarget } from "./instruction-files-read.js";
import { layerSettings, settingsFiles, type ParsedSettings } from "./settings-layers.js";

/** A settings file's JSON object, or why there is none. Through links as Claude Code reads them, never
 *  to a network path; a file not a JSON object (or too large to be one anyone wrote) is one it skips. */
async function readSettingsFile(file: string): Promise<{ state: SettingsFile["state"]; json: Record<string, unknown> | null }> {
  const real = await localTarget(file);
  const info = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || info === null || !info.isFile()) return { state: "absent", json: null };
  if (info.size > LIBRARY_FILE_TEXT_MAX) return { state: "invalid", json: null };
  const text = await fs.readFile(real, "utf8").catch(() => null);
  try {
    const json: unknown = text === null ? null : JSON.parse(text);
    return isRecord(json) ? { state: "ok", json } : { state: "invalid", json: null };
  } catch {
    return { state: "invalid", json: null };
  }
}

/** Each settings file Claude Code reads in `cwd`, and the result of laying them over each other. */
export async function readSettings(cwd: string, configDir: string, platform: NodeJS.Platform = process.platform): Promise<LibrarySettings> {
  const candidates = settingsFiles(cwd, configDir, platform);
  const read = await Promise.all(candidates.map(async (candidate) => ({ ...candidate, ...(await readSettingsFile(candidate.path)) })));
  const layers: ParsedSettings[] = read.flatMap(({ source, json }) => (json === null ? [] : [{ source, json }]));
  return { ...layerSettings(cwd, layers), files: read.map(({ source, path, state }) => ({ source, path, state })) };
}
