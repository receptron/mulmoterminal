// What xterm needs to know about a Windows pty (its `windowsPty` option). node-pty runs ConPTY there,
// which repaints the screen on a resize and wraps lines its own way; xterm reflows what it holds on a
// resize, and without this it assumes a unix pty. Pure: the caller supplies the platform and release.
export interface TerminalWindowsPty {
  backend: "conpty";
  buildNumber: number;
}

// `os.release()` on Windows is "<major>.<minor>.<build>", e.g. 10.0.22631 on both Windows 10 and 11.
const WINDOWS_RELEASE = /^\d+\.\d+\.(\d+)$/;

export function windowsPtyFor(platform: string, release: string): TerminalWindowsPty | null {
  if (platform !== "win32") return null;
  const build = WINDOWS_RELEASE.exec(release)?.[1];
  const buildNumber = build === undefined ? Number.NaN : Number(build);
  return Number.isSafeInteger(buildNumber) && buildNumber > 0 ? { backend: "conpty", buildNumber } : null;
}

export const isTerminalWindowsPty = (value: unknown): value is TerminalWindowsPty =>
  typeof value === "object" &&
  value !== null &&
  "backend" in value &&
  value.backend === "conpty" &&
  "buildNumber" in value &&
  typeof value.buildNumber === "number" &&
  Number.isSafeInteger(value.buildNumber) &&
  value.buildNumber > 0;
