// Browsers hide a dropped file's real path on the File object (security); the
// absolute path is only reachable through the file:// URIs some browsers put in
// the drag's text/uri-list. These helpers turn that list into the text we inject
// into the terminal — pure so they can be unit-tested without a DataTransfer.

const SHELL_SAFE = /^[A-Za-z0-9_./:@%+,=-]+$/;

function fileUriToPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const pathname = decodeURIComponent(url.pathname);
    // A UNC share (Windows) arrives as file://server/share/x — preserve the host,
    // or the inserted path silently loses it. → \\server\share\x
    if (url.hostname && url.hostname !== "localhost") return `\\\\${url.hostname}${pathname}`.replace(/\//g, "\\");
    // A Windows drive path arrives as "/C:/dir"; drop the leading slash.
    return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}

export function parseFileUris(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(fileUriToPath)
    .filter((path): path is string => path !== null);
}

// Single-quote anything that isn't a bare safe path so spaces and shell-special
// characters survive both a shell prompt and Claude's TUI.
export function toShellArg(path: string): string {
  if (SHELL_SAFE.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function toInsertText(paths: string[]): string {
  return paths.map(toShellArg).join(" ");
}

export function dropTextFromUriList(uriList: string): string {
  return toInsertText(parseFileUris(uriList));
}

// A drag carries external files when its type list includes the "Files" sentinel.
// Internal element drags (custom types / plain text) don't, so anything keyed on this
// intercepts only file drops — the window-level navigation guard never swallows an
// in-app drag. `types` is a DataTransfer.types (available during dragover, when
// `.files` is still empty).
export function dragCarriesFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}
