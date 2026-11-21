// The relay markers on disk (#3389): hydrated once at boot, appended to on every recorded relay.

import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../../config/env.js";
import { forEachJsonlRecord } from "../../infra/fs/jsonl-file.js";
import { trackPersistQueue } from "../reaping/persist-drain.js";
import { applyRelayMark, relayMarkLine, relayMarkMapKey, relayMarkRecord, type RelayMarkKey, type RelayMarkRecord } from "./relay-marks.js";

const RELAY_MARKS_FILE = path.join(MULMOTERMINAL_HOME, "relay-marks.jsonl");
const relayMarks = new Map<string, string>();

const isValidId = (id: string): boolean => SESSION_ID_RE.test(id);

export const relayMarksHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(RELAY_MARKS_FILE, (parsed) => {
      const record = relayMarkRecord(parsed, isValidId);
      if (record) applyRelayMark(relayMarks, record);
    });
  } catch {
    // absent on first run / unreadable => no markers, so the next relay starts from the newest turns
  }
})();

export async function relayMarkOf(key: RelayMarkKey): Promise<string | null> {
  await relayMarksHydrated;
  return relayMarks.get(relayMarkMapKey(key)) ?? null;
}

let persist: Promise<void> = Promise.resolve();
trackPersistQueue(() => persist);

/** Record where a relay ended, once the append is on disk. A failed write rejects and leaves the
 *  old marker in memory, so the next relay repeats these turns rather than skipping past them. */
export async function setRelayMark(record: RelayMarkRecord): Promise<void> {
  await relayMarksHydrated; // or the older line hydration is still reading would win over this one
  const append = persist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(RELAY_MARKS_FILE, relayMarkLine(record, Date.now())));
  // The chain must survive this write failing — it serializes the appends.
  persist = append.catch(() => {});
  await append;
  applyRelayMark(relayMarks, record);
}
