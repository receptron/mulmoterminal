// Claude Code's `cleanupPeriodDays` as its user settings file sets it (#3333). Pure: the caller reads
// the file. Claude Code rejects anything below 1, so such a value is reported as unreadable rather
// than shown as a period it will not use.
import { isRecord } from "../../../common/isRecord.js";
import { CLEANUP_PERIOD_DEFAULT_DAYS, type CleanupPeriod } from "../../../common/libraryStorage.js";

/** `text` is the settings file's contents, or null when there is no file. */
export function cleanupPeriodOf(text: string | null): CleanupPeriod {
  if (text === null) return { state: "default", days: CLEANUP_PERIOD_DEFAULT_DAYS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unreadable" };
  }
  if (!isRecord(parsed)) return { state: "unreadable" };
  const days = parsed.cleanupPeriodDays;
  if (days === undefined) return { state: "default", days: CLEANUP_PERIOD_DEFAULT_DAYS };
  return typeof days === "number" && Number.isInteger(days) && days >= 1 ? { state: "set", days } : { state: "unreadable" };
}
