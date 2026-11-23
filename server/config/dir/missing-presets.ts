import path from "node:path";

/** Saved directories that no longer answer, split by whether that is permanent. */
export interface MissingPresets {
  /** Absent while the parent is present: deleted, so safe to forget. */
  gone: string[];
  /** Absent along with the parent: an unmounted drive looks exactly like this, so only hide it. */
  unreachable: string[];
}

/** Classify saved directory paths by presence. `isAbsent` must answer true only for a definite
 *  "not there" (ENOENT/ENOTDIR) — anything uncertain has to read as present, or a permission error
 *  would delete a saved entry. Relative paths are skipped: there is nothing to resolve them against. */
export function classifyMissingPresets(paths: readonly string[], isAbsent: (dir: string) => boolean): MissingPresets {
  const absent = paths.filter((dir) => path.isAbsolute(dir) && path.dirname(dir) !== dir && isAbsent(dir));
  const parentAbsent = (dir: string) => isAbsent(path.dirname(dir));
  return {
    gone: absent.filter((dir) => !parentAbsent(dir)),
    unreachable: absent.filter(parentAbsent),
  };
}
