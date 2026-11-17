// The spellings of a symlink target that the component walk in pathContainment.ts does not read the way
// Windows does. A dangling link with one of these is refused rather than guessed at: refusing costs
// only a link that leads nowhere yet, and a wrong guess is a path the gate answers for someone else.

/** Is `target` a form the walk cannot follow as `platform` would? */
export function unwalkableLinkTarget(target: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  // `C:foo` is relative to drive C's current folder, not to the folder the link is in.
  if (/^[A-Za-z]:(?![\\/])/.test(target)) return true;
  // `\\server\share`, `\\?\…`, `\\.\…`: roots `path.parse` does not cut where Windows does, so `..`
  // could climb above them.
  return /^[\\/]{2}/.test(target);
}
