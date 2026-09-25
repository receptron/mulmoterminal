// A path relative to some directory that cannot leave it: segments separated by "/", none empty,
// none "." or "..", each matching `segment`. Checked segment by segment rather than with one
// repeated-group regex, which is how such a pattern stays linear on hostile input.
export function isContainedRelativePath(value: string, segment: RegExp): boolean {
  if (value === "") return false;
  return value.split("/").every((part) => part !== "." && part !== ".." && segment.test(part));
}
