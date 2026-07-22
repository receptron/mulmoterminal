// The two decisions spawn-shell.ts makes before it touches a PTY: which shell invocation
// runs a command, and which configured launcher an index refers to. Both are pure and both
// are load-bearing — the invocation differs per platform (and only Windows CI would catch
// a mistake), and the index guard is what stops a browser-supplied number from reaching
// outside the configured allowlist.

export interface ShellInvocation {
  shell: string;
  args: string[];
}

/** How to run `command` through the platform's shell. `replaceShell` runs it under `exec`
 *  so the program becomes the PTY's foreground process rather than a child of the shell —
 *  POSIX only, since `powershell -Command` already runs exactly the one command. The
 *  command stays a single argv element, so nothing in it is re-split into arguments.
 *  `platform` and `shellPath` are passed in rather than read here, so the choice is a
 *  function of its arguments and both arms can be checked from any host. */
export function shellInvocation(command: string, replaceShell: boolean, platform: string, shellPath: string | undefined): ShellInvocation {
  if (platform === "win32") return { shell: "powershell.exe", args: ["-NoLogo", "-Command", command] };
  return { shell: shellPath || "/bin/bash", args: ["-lc", replaceShell ? `exec ${command}` : command] };
}

/** The entry at `index`, or null when the index is not a real position in the list. The
 *  browser sends only an index — the configured list is the allowlist — so a fractional,
 *  negative, or past-the-end index has to resolve to nothing rather than to undefined. */
export function launcherAt<T>(list: readonly T[], index: number): T | null {
  return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}
