# Windows gotchas

Traps this codebase has actually hit on Windows, each with where the fix lives. Read before
debugging a Windows-only failure, and before writing a path comparison, a spawn, or an
`fs.watch` that will run there.

Two jobs execute any of this. `windows-pr.yaml` runs on every pull request and executes `yarn test`
whenever the PR touches something other than docs, plans and markdown — so a portability regression
is caught before it reaches `main`. (It always runs and always reports: a workflow filtered out at
the trigger produces no check at all, which would leave a docs-only PR waiting forever on a
required gate.) `windows-daily.yaml` is the fuller one: lint, typecheck, build and test
across Node 22 and 24, daily and on pushes to `main`. Dispatch that one on a branch with
`gh workflow run windows-daily.yaml --ref <branch>` when a change needs the wider check before
merging.

## Spawning

**`CreateProcessW` runs PE images only.** A `.cmd`, a `.bat`, and an extensionless shell shim
cannot be executed directly — they need `cmd.exe`. An npm-global install leaves exactly those
(`claude`, `claude.cmd`, `claude.ps1`) and no `.exe`.

**node-pty's PATH lookup matches file names exactly.** `src/win/path_util.cc get_shell_path`
never appends an executable extension, so a bare `claude` misses `claude.exe` and the spawn
fails with `File not found: ` — with *nothing* after the colon, because the path it failed to
find is the empty string. Two further bugs live in the same function: the PATH splitter drops
the segment after the final `;`, and a name that exists relative to the cwd returns empty.

**The existence gate and the actual launch resolve differently.** node-pty checks the file
exists via its own lookup, then calls `CreateProcessW(nullptr, cmdline, …)`, which does its
own PATH search and appends `.exe`. A command can therefore pass the gate on one file and run
a different one — which is how an extensionless shim "works" by accident.

→ `server/infra/resolve-bin.ts` resolves the name before node-pty sees it, and
`server/infra/cmd-escape.ts` wraps a batch target in `cmd.exe /d /s /c`. Both are reached from
the single `spawnPty()` in `server/session/pty-spawn.ts` (#794, #798).

**cmd.exe re-parses the command line before the child's CRT does.** `\"` — the CRT's escape,
and what node-pty's own `argsToCommandLine` emits — does not escape a quote for cmd; it *ends*
the quoted run, after which a `&` in the same argument is a command separator. Quote every
argument, double internal quotes (`""`), double a trailing backslash run, and reject NUL/CR/LF.
`%VAR%` is still expanded inside double quotes and cmd has no escape for it. Rust hit this in
CVE-2024-24576; Node answered CVE-2024-27980 by refusing to spawn `.cmd` without a shell.

## Paths

**`path.resolve` drive-qualifies.** `path.resolve("\\home\\u")` becomes `C:\home\u`. Resolving
one side of a comparison and not the other silently stops matching — that was #802.

**Comparison is case-insensitive.** NTFS and the Win32 API treat `C:\Users\u` and `c:\users\u`
as one directory; `String.startsWith` and `===` do not. macOS is *usually* case-insensitive
too, but a case-sensitive APFS volume is a supported setup, so folding there would widen a
containment guard on a guess.

**A prefix is not containment.** `…\project-old` starts with `…\project` as a string. The
separator is what makes the check a boundary.

→ `server/infra/path-within.ts` — `isWithin` / `isStrictlyWithin` / `isSamePath`. Use these
rather than hand-rolling `target.startsWith(base + path.sep)`; several callers are security
boundaries, and the lexical answer still needs a realpath pass for symlinks.

## Tests that handle paths

**Build the EXPECTED path with `path.resolve` too, never as a POSIX literal.** A rule that
resolves with the platform's own `path` produces `<drive>:\shared-lib` on Windows (drive-qualified,
per the section above — the CI failure read `D:\shared-lib`) and `/shared-lib` elsewhere, so an
expectation written as `"/shared-lib"` matches on the developer's machine and nowhere else. `yarn test` stays green locally and the daily Windows job goes red — #912's
`resolveAddDirs` spec cost exactly that.

**A stubbed predicate that compares paths has the same problem, and it fails silently.** That
spec's EACCES case asked `p === "/denied"`, which on Windows never matched — so nothing threw,
both entries survived, and the property under test ("a throwing check drops only its own
entry") was not being tested there at all. A path-comparing stub is a path comparison: resolve
its operand as well.

```ts
const BASE = path.resolve("/repo");            // C:\repo on Windows, /repo elsewhere
const SIBLING = path.resolve(BASE, "../lib");  // the expectation, computed the same way
```

→ `test/server/config/add-dirs.spec.ts` for the shape.

**A double that routes on a file NAME is a path comparison too.** The specs that mock `node:fs`
pick a log apart by basename, and `String(file).split("/").pop()` returns the whole path on
Windows — so a read falls through to `""` and a recorded write filters out to nothing. Neither
throws: the spec reads empty logs and reports the feature as broken. #1189 and #1196 each shipped
one, and Windows daily went red on 12 consecutive runs before it was traced (#1212).

Use `mockedFileName()` from `test/support/mockFsPath.ts` (`split(/[/\\]/)`). Not `path.basename` —
correct at runtime, but on POSIX it leaves `\` alone, so the Windows case cannot be asserted on the
machine that runs the suite. Not `endsWith` either: `unplaced-sessions.json` ends with
`placed-sessions.json`, so a suffix match reads the two logs as one.

**Verify on the real runner before merging**, with the dispatch at the top of this file. Local
`yarn test` on macOS/Linux cannot see any of this — the whole class only appears where the
separator and the drive letter differ.

**A fixture the filesystem refuses to create takes the WHOLE spec file with it.** Two things
Windows will not do, and both throw in `beforeAll` — where the failure reports as
`1 failed` at the FILE level with zero failing tests, so it reads as the feature being broken
rather than as the fixture being unbuildable:

- **`symlinkSync` needs Developer Mode or an elevated shell.** Guard with
  `canSymlink` (`test/support/canSymlink.ts`) and mark the spec `it.runIf(canSymlink)`.
- **`< > : " / \ | ? *` are illegal in a filename.** A spec about quoting or escaping reaches for
  a name like `weird";name.png` precisely because it is awkward — and that one cannot exist on
  NTFS. Guard with `canNameFile(name)` (`test/support/canNameFile.ts`).

Both are PROBES rather than `process.platform` checks, for the same reason: the question is what
the filesystem under this runner accepts, and a Windows box with Developer Mode on should run the
symlink specs. Non-ASCII names are fine — `月次 レポート.png` writes without complaint.

#2040 paid for both in sequence: the symlink fixture went red first, and fixing it revealed the
quoted one underneath. Each cost a full Windows round (~15 min), and neither is visible on
macOS or Linux. Simulate locally before pushing by forcing the probe to `false`.

**`..` is folded LEXICALLY by the Win32 path API, before any symlink is followed.** POSIX does the
opposite: the kernel resolves `link` first and only then applies `..`, so `…/link/../x` can name a
different file from `path.resolve("…/link/../x")`. On Windows the two always agree, because the
path is normalised textually before the reparse point is touched.

That difference is a fact about the platform, and a test that asserts one side of it is red on the
other. #2039 shipped a regression test whose FIRST line was `expect(statSync(asked).isDirectory())
.toBe(true)` — true on macOS, false on Windows, green locally and red on the runner. The fix is not
to skip the test: **measure the divergence, then assert the invariant that holds either way.**

```ts
const diverges = statSync(asked).isDirectory() !== statSync(path.resolve(asked)).isDirectory();
expect(diverges).toBe(process.platform !== "win32");   // the platform fact, stated
expect(spawned).toEqual(argvFor(path.resolve(asked))); // the invariant, true on both
```

This is the one place a `process.platform` check belongs — the thing under test IS the platform's
own behaviour, so probing for it would be probing for the answer. Everywhere else in this file the
rule is the opposite: probe the filesystem, do not ask which OS this is.

## File permissions

**`chmod` moves the read-only attribute and nothing else.** There are no POSIX permission bits
on NTFS, so `chmodSync(file, 0o000)` leaves the file perfectly **readable** — only writing is
refused. A test that makes a file unreadable to prove a read failure is reported (rather than
answered as "empty") therefore proves nothing there: the read succeeds and the assertion fails
(`rooms.spec.ts` and `room-routes.spec.ts`, #1484).

A `process.getuid?.() !== 0` guard does not cover this. It is there because root defeats the
bit too — but on Windows `process.getuid` is **undefined**, so `undefined !== 0` is true and the
assertion runs anyway. Skip the whole test with `it.skipIf(process.platform === "win32")`, the
way `test/server/session/session-settings.spec.ts` does for the owner-only-mode check.

## Filesystem watching

**`fs.watch` on an 8.3 short path is unreliable, and can abort the process.** `os.tmpdir()`
returns `C:\Users\RUNNER~1\…` on a GitHub runner; expand it with **`realpathSync.native`**
before watching — plain `realpathSync` is the JS implementation and hands the short name straight
back, which is how a spec that already called it still compared `RUNNER~1` against git's
`runneradmin` (Windows daily, 2.5.1). Even then Windows gives no delivery guarantee — the reload case in
`test/scripts/dev-server.spec.ts` is skipped there rather than left to flake.

## Environment

**`process.env` is case-insensitive, a copy of it is not.** Windows spells it `Path` and
`ComSpec`; `Object.entries(process.env)` keeps that casing, so `copy.PATH` is `undefined`.
→ `envValue()` in `server/infra/pty-env.ts`.

## Machine metrics

**`os.loadavg()` returns `[0, 0, 0]` on Windows** — and only there; macOS and Linux report the
host's real figures. Windows keeps no load average, and Node says so by returning zeros rather than
by failing — so a caller that trusts the numbers draws an idle machine on a machine it cannot see. Branch on `process.platform`, never on the values: an idle mac
reports `0.00` too. → `keepsLoadAverage()` in `common/machineLoad.ts`, which is what makes the
grid header's load read-out absent rather than `0%` there (#1786).
