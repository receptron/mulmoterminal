// The relay markers on disk (#3389).
//
// Read from the file on every relay rather than hydrated once: a second server instance on this
// machine appends to the same log, and a map loaded at boot would never see its markers — so it
// would relay again what the other had already pasted.

import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../../config/env.js";
import { forEachJsonlRecord } from "../../infra/fs/jsonl-file.js";
import { hasErrnoCode, messageOf } from "../../errors.js";
import { trackPersistQueue } from "../reaping/persist-drain.js";
import { applyRelayMark, relayMarkLine, relayMarkMapKey, relayMarkRecord, type RelayMarkKey, type RelayMarkRecord } from "./relay-marks.js";

const RELAY_MARKS_FILE = path.join(MULMOTERMINAL_HOME, "relay-marks.jsonl");

const isValidId = (id: string): boolean => SESSION_ID_RE.test(id);

export async function relayMarkOf(key: RelayMarkKey): Promise<string | null> {
  const marks = new Map<string, string>();
  try {
    await forEachJsonlRecord(RELAY_MARKS_FILE, (parsed) => {
      const record = relayMarkRecord(parsed, isValidId);
      if (record) applyRelayMark(marks, record);
    });
  } catch (e) {
    // No log yet is no marker. Anything else is logged and read as no marker too: the relay then
    // starts from the newest turns, which repeats some rather than skipping any.
    if (!(hasErrnoCode(e) && e.code === "ENOENT")) console.error(`[relay] ${RELAY_MARKS_FILE}: ${messageOf(e)}`);
  }
  return marks.get(relayMarkMapKey(key)) ?? null;
}

let persist: Promise<void> = Promise.resolve();
trackPersistQueue(() => persist);

/** Record where a relay ended, once the append is on disk.
 *
 *  Not compare-and-set: two overlapping relays of one key can append the older marker last. The
 *  cost is that the next relay repeats a turn, never that it skips one, which is the safe side. */
export async function setRelayMark(record: RelayMarkRecord): Promise<void> {
  const append = persist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(RELAY_MARKS_FILE, relayMarkLine(record, Date.now())));
  // The chain must survive this write failing — it serializes the appends.
  persist = append.catch(() => {});
  await append;
}
