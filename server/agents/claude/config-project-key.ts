// Claude Code keys `projects` in its config by a path whose separators are all `/`, on Windows too
// ("C:/work/app"), so a key spelled with `\` is a string it never looks up. Only where `\` IS the
// separator: on POSIX it is an ordinary filename character and must survive untouched.
import path from "node:path";

/** Pure: the spelling Claude Code uses for `absolutePath` as a key of its config's `projects`. */
export function claudeConfigProjectKey(absolutePath: string, separator: string = path.sep): string {
  return separator === "\\" ? absolutePath.replaceAll("\\", "/") : absolutePath;
}
