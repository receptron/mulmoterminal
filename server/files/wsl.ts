// WSL is a Linux `process.platform` with a Windows host one interop call away: `powershell.exe`
// runs from here, and `wslpath` translates a path between the two filesystems. That matters for
// anything that opens a GUI — WSL ships no Linux desktop, so the OS dialog a user has is the
// Windows one (#1447).
import os from "node:os";
import { spawnCaptureAsync } from "../infra/spawnCapture.js";

// WSL's own kernel names itself: `6.6.x-microsoft-standard-WSL2`, and `…-Microsoft` on WSL1. The
// two are NOT told apart on purpose — both have interop and `wslpath`, so a WSL1 user wants
// exactly what a WSL2 user gets.
const WSL_KERNEL = /microsoft/i;

// The environment variables WSL exports are the documented signal, but they only reach a process
// started from a LOGIN SHELL — a server run by systemd inside the distro has neither, and would
// read as a bare Linux box with no dialog at all. The kernel name has no such hole, so it is the
// second opinion rather than the first.
//
// A false positive is cheap by construction: every caller falls back to the Linux command when
// the Windows one cannot be started. A false NEGATIVE is what costs the user the dialog.
// `||`, never `??`: an EMPTY `WSL_DISTRO_NAME` is not an answer, and `??` would accept it and
// never look at `WSL_INTEROP`. It is also what bin/mulmoterminal.js does, and the two must not
// reach different conclusions about the same machine (Codex review on #1463).
export function isWsl(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, kernelRelease: string = os.release()): boolean {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  return WSL_KERNEL.test(kernelRelease);
}

/** Runs `wslpath` with the given arguments. Injected so the conversions are testable off WSL. */
export type WslpathRunner = (args: string[]) => Promise<{ status: number | null; stdout: string }>;

// Short: wslpath is a string translation, so anything slower than this means the interop bridge is
// not answering, and waiting longer only delays the fallback.
const WSLPATH_TIMEOUT_MS = 5_000;

const runWslpath: WslpathRunner = (args) => spawnCaptureAsync("wslpath", args, { timeoutMs: WSLPATH_TIMEOUT_MS });

async function convert(flag: string, value: string, run: WslpathRunner): Promise<string | null> {
  const { status, stdout } = await run([flag, value]);
  if (status !== 0) return null;
  // Exactly the line terminator `wslpath` writes, never `trim()`. A trailing space is a legal
  // character in a filename on both sides, and trimming it translates one path and hands back
  // another — the same trap `dirPathKey` set for a workspace whose name ended in a space (#1934)
  // and `servedFileName` for a saved file (#2040). Reached here from every caller of
  // toWindowsPath / toLinuxPath: reveal, open-dir and the file picker (Codex P3 on #2039).
  const converted = stdout.replace(/\r?\n$/, "");
  // Whitespace-only output is still no answer: `wslpath` printing blanks has told us nothing,
  // and the callers take null as "this opener cannot express the path" rather than as a path.
  return converted.trim().length > 0 ? converted : null;
}

/** `C:\proj` / `\\wsl.localhost\Ubuntu\home\me` → the path this process can open, or null. */
export const toLinuxPath = (windowsPath: string, run: WslpathRunner = runWslpath): Promise<string | null> => convert("-u", windowsPath, run);

/** `/home/me` → the path a Windows program can open, or null. */
export const toWindowsPath = (linuxPath: string, run: WslpathRunner = runWslpath): Promise<string | null> => convert("-w", linuxPath, run);
