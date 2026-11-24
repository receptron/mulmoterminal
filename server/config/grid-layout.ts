// A copy of the grid's layout (#3427). The browser's `grid_v2` is the one the grid runs from; this
// copy is what a browser that lost it (a full disk, a cleared profile, another origin) is offered back.
// Opaque here: the browser wrote it and the browser validates it when it reads it back.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME } from "./env.js";
import { readJsonFile } from "../infra/fs/read-text-file.js";
import { writeFileAtomicSync } from "../files/atomic-write.js";
import { isRecord } from "../../common/isRecord.js";

export const GRID_LAYOUT_FILE = path.join(MULMOTERMINAL_HOME, "grid-layout.json");

/** Far above a full grid of cells, which serialise to a few tens of kilobytes. */
export const GRID_LAYOUT_MAX_BYTES = 1024 * 1024;

/** The saved layout, or null when there is none or it cannot be read as one. */
export function readGridLayout(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file) || statSync(file).size > GRID_LAYOUT_MAX_BYTES) return null;
    const parsed: unknown = readJsonFile(file);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** False when it could not be written — a full disk is the case this exists for, and the copy
 *  already on disk is then left as it was. */
export function writeGridLayout(file: string, serialized: string): boolean {
  try {
    writeFileAtomicSync(file, serialized);
    return true;
  } catch {
    return false;
  }
}
