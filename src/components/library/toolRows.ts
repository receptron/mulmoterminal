// How the tools kind names an instruction file (#3332): by its path under the chosen directory when it
// is there, whole when it is elsewhere (the user's, a parent's, the managed one).
import { trimEndOf } from "../../../common/trimEndOf";

const SEPARATORS: ReadonlySet<string> = new Set(["/", "\\"]);

export function instructionLabel(file: { path: string }, cwd: string): string {
  const base = trimEndOf(cwd, SEPARATORS);
  const inside = base !== "" && (file.path.startsWith(`${base}/`) || file.path.startsWith(`${base}\\`));
  return inside ? file.path.slice(base.length + 1) : file.path;
}
