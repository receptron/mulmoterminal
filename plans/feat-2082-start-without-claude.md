# The app must not require Claude Code to start (#2082)

`npx mulmoterminal` refuses to start when `claude` is not on PATH, so a machine running Codex or
GitHub Copilot CLI never reaches the app at all. The server itself has no such requirement — the
gate is one `process.exit(1)` in the CLI wrapper.

## Two defects, and the second one hits people who DO use Claude Code

Both reproduced before designing anything, against 4.24.0 with a PATH holding `codex` / `git` /
`gh` / `tmux` / `node` and no `claude`:

1. **The gate itself.** `bin/mulmoterminal.js:621` exits 1 with "Claude Code CLI not found."
   Codex is present and irrelevant to it.
2. **The gate ignores `CLAUDE_BIN`.** `claudeInstalled()` is `hasCommand("claude")` — a PATH
   lookup of the literal name. The server's own resolver is `process.env.CLAUDE_BIN || "claude"`
   (`server/agents/claude.ts:18`, and `CLAUDE_BIN` is documented in README). So with
   `CLAUDE_BIN=/Users/…/.local/bin/claude` pointing at a **working claude 2.1.272** and `claude`
   merely absent from PATH, the CLI still refuses to start — and tells the user to install
   something they already have. Confirmed in the same shell that the server-side resolution
   succeeds.

The second is a bug for current users, not a feature request, and it is why this is one PR: the
gate is wrong about Claude Code in exactly the way it is wrong about everyone else.

## What replaces the gate

**"At least one TERMINAL_AGENT is installed", not "no gate at all".** A machine with no agent CLI
gets a reason instead of an empty grid. Seven agents, each with its own `<AGENT>_BIN` override:

| agent | default command | override |
|---|---|---|
| claude | `claude` | `CLAUDE_BIN` |
| codex | `codex` | `CODEX_BIN` |
| antigravity | `agy` | `ANTIGRAVITY_BIN` |
| grok | `grok` | `GROK_BIN` |
| muse | `muse` | `MUSE_BIN` |
| copilot | `copilot` | `COPILOT_BIN` |
| cursor | `cursor-agent` | `CURSOR_BIN` |

**`bin/` cannot import that table.** It runs as plain JS before tsx exists, which is why
`isWslHost()` already mirrors `server/files/wsl.ts` with a "keep the two in step" comment. So the
table is mirrored and **pinned by a spec** against `TERMINAL_AGENTS` and each adapter's real
`bin()` / `binEnvVar` — the same device `BUNDLED_SKILL_NAMES` uses. A mirrored list nobody checks
is how an eighth agent silently fails to count.

## The real work is the default agent, and the trap is what "default" means

Removing the gate alone leaves a Codex-only user looking at a launch form that says Claude, whose
cell then fails to spawn. But there are TWO defaults here and only one of them may move:

- **The WIRE default stays `claude`, permanently.** `asTerminalAgent(anything unrecognised)` is
  `claude`, `storedCellAgent` omits the field when it is claude, `agent ?? "claude"` appears across
  the UI and the protocol. That is not a preference — it is what an older persisted cell, written
  before the field existed, MEANS. Changing it would rewrite the meaning of data already on disk.
- **The initial PICK may move.** Two refs hold it: `launchAgent` (`useChatLauncher.ts:39`, persisted
  in localStorage) and `pickedAgent` (`LaunchPanel.vue:51`). These are "what the form offers before
  the user has said anything", and offering something that cannot run is the defect.

So this adds an availability signal and moves only the second. No config key: the rule is "claude if
it is installed, otherwise the first installed agent in `TERMINAL_AGENTS` order", which needs
nothing remembered and nothing documented in `mulmoterminal-model` or the guides.

**The correction is applied ONCE and never fights the user.** Availability arrives over HTTP, after
the refs are already initialised synchronously at module scope; it rewrites the value only if the
value is still the one it was initialised to. A user who deliberately picks an uninstalled agent
keeps it — that is a real thing to want while installing one.

## Where availability comes from

`GET /api/agents` → `{ agents: { agent, installed }[] }`, the wire type in `common/` because both
sides decide from it. Resolved ONCE at boot, like `AGENT_BINS` and for the same stated reason:
`<AGENT>_BIN` is a start-up setting, so asking per request would answer a question nobody changed.

`hasBinary()` from `server/infra/has-binary.ts` already answers it, including the `<AGENT>_BIN`
override and the "exists but is not executable" case — nothing new is needed there.

## What was verified, and how

**The gate, run three ways against the real CLI** with a PATH holding `node` / `git` / `gh` / `tmux`
and nothing else added:

| | result |
|---|---|
| `codex` present, no `claude` | `Agent CLIs ✓  codex` — starts, where 4.24.0 exited 1 |
| `CLAUDE_BIN` at a working claude 2.1.272, `claude` off PATH | `Agent CLIs ✓  claude codex` — the bug |
| no agent at all | refuses with all seven install lines, exit 1 |

`npx mulmoterminal init` now reports every agent rather than Claude Code alone, and names the
variable when one is the source: `✓ claude — claude (CLAUDE_BIN)`.

**The route, on a real server.** Started from this checkout on a spare port under a scratch `HOME`
(so the live config was never touched) with every `<AGENT>_BIN` but codex pointed at a path that
does not exist: `GET /api/agents` answers all seven rows with `codex` alone installed. Stopped by
PORT afterwards; the port is free and the user's own server on 34567 still answers 200.

**Break-verification.** Each mutation applied to a file checked against a pristine copy first and
restored and re-checked after; all four matched at the end.

| mutation | went red |
|---|---|
| the gate ignores `<AGENT>_BIN` again (the original bug) | 2 |
| an agent drops out of the launcher's table | 2 |
| cursor is looked for under the wrong command name | 2 |
| "unknown" is treated the same as "not installed" | 1 |
| a value the user already changed is overwritten too | 2 |
| an agent that is not installed can be offered | 3 |
| the probe is asked about the agent name rather than the resolved bin | 3 |

**What was NOT exercised locally: the browser half.** `agentCorrection` is pure and covered in both
directions, and the route is verified against a real server — but that the composable is actually
CALLED, and that the picker visibly lands on codex, was not driven in a browser (no Playwright on
this machine). The correction is a no-op wherever claude is installed, which is every machine this
was developed on, so that is the part a reviewer should look at rather than take on trust.

**One test caught a documentation slip**, and it was the guard working rather than a false alarm:
`agentSetClaims.spec.ts` scans prose for "<number> agent CLIs" and checks the count against the real
seven. "at least **one** agent CLI" tripped it. The README was reworded rather than the guard
loosened — the sentence states a requirement and does not need a number at all.

## The launcher has to agree with the SERVER, not merely have an opinion

Found during the cross-review setup, before round 1, and reproduced rather than reasoned about:

```
CLAUDE_BIN="/Applications/My Tools/claude"     (a real, working claude)
  launcher  hasCommand → false     the app refuses to start
  server    hasBinary  → true      it would spawn it without complaint
```

`hasCommand` builds a SHELL STRING — `execSync(\`${cmd} --version\`)` — so a path with a space in
it is split at the space and reported missing. That is new in this change: before it, `hasCommand`
only ever saw literal names from `PATH_TOOLS`. And it re-creates #2082's own complaint through a
different door — the app refusing to start for someone who has the agent installed — on paths that
are entirely ordinary (`C:\Program Files\…`, `/Applications/…`).

So the launcher now asks the question the way the server asks it (`namesAPath` → `diagnosePathName`,
server/infra/): a bare NAME goes through the shell, because `npm install -g` on Windows produces
`codex.cmd` which CreateProcess cannot run without one; a PATH is asked of the filesystem — it must
be a file, and on POSIX it must be executable. Windows has no execute bit, so existing is the whole
question there.

Verified across five cases end to end: a spaced `CLAUDE_BIN` is now counted, the three original
cases are unchanged, and a file without the execute bit is refused on POSIX — which is the server's
answer too.

## What the Codex cross-review changed (round 1)

Three findings, all real, and two of them exposed a further defect that the finding itself did not
name.

**A bare `<AGENT>_BIN` reached a shell.** `hasCommand` builds `execSync(\`${cmd} --version\`)`, and
measured, `CODEX_BIN='echo hi; touch /tmp/x'` ran the `touch`. Codex called it arbitrary local
execution from a hostile environment; **the premise is wrong and the finding is still right.** A
repo-local `.env` does NOT reach this process — `bin/cli-args.js:431` hands it to the SERVER CHILD as
`--env-file-if-exists` — so `<AGENT>_BIN` is the user's own shell and there is no privilege boundary
to cross. What IS real is the wrong answer: `CODEX_BIN="my codex"` was split at the space and
silently probed something else instead of being reported missing. A bare name must now match
`/^[A-Za-z0-9_.+@-]+$/` before the shell is asked. Codex accepted the correction.

**Relative overrides diverged, which is my earlier fix being half right.** `diagnosePathName` returns
ok for a non-absolute path deliberately — it resolves against the PTY's cwd, not ours, so it cannot
be answered from here — while the launcher probed its own cwd. Measured: `./claude`, `dir/claude`
and `../bin/claude` were all server=true / launcher=false. Now mirrored.

**And that fix opened a hole my own test caught, not Codex's.** Every one of Codex's injection
examples contains a `/`, so with "relative ⇒ true" they became INSTALLED AGENTS: no execution, but
the gate would pass on a machine with nothing on it — the one thing the gate exists to catch. The
shortcut is now guarded by `couldBeABinary` (shell operators and control characters only; spaces,
dots and separators stay legal because real paths have them). Codex agreed with where the line was
drawn, and specifically that the launcher must NOT become stricter than the server, which would
re-create the divergence in the other direction.

**The async race — I declined half of it and was wrong.** Availability arrives over HTTP, and I
argued the UI half was unreachable in practice and not worth blocking a control for. Codex DISPUTED
it with the concrete interleaving (fetch in flight, grid interactive, panel opened and started), and
the cost argument did not survive the fix to `loadAgentAvailability` below: once the answer is
cached, `await` is a single microtask, so the cell appears exactly when it always did and the wait
exists only in the window that was the bug. Both launch paths now await.

**The suite then caught a third defect in those fixes: `loadAgentAvailability` was not "once per
page", and its comment said it was.** `inFlight` is cleared when the request settles, so every
`startCollectionChat` would have re-fetched `/api/agents`. It now keeps a `loaded` flag, set on
success only — the shape `useLaunchOptions` already had, for the reason it already documented: a
FAILED fetch must not count, or one lost race with a starting server freezes the answer at "nothing
known" for the rest of the session.

Break-verified: removing the `await` in `startCollectionChat` reddens the new race spec, which
asserts the ORDER (`/api/agents` settles before the spawn goes out) rather than just the outcome.

## Round 2 — the gate could be hung by an agent nobody asked for

One P2, reproduced with a real hanging binary before it was accepted. The old gate probed ONE name;
this one probes seven, six of which the user may not control — a stale shim on someone's PATH is
enough. Measured with a `grok` on PATH that blocks for 30 seconds and a `claude` that answers
immediately:

Measured **against the shipped CLI** — time from spawn to the launcher's own gate line, with a
normal machine as the control so that a fast number is recognisable as fast:

| | gate line | `init` (probes every row) |
|---|---|---|
| before | **30,059 ms** — and `grok` was then reported INSTALLED, because `sleep` exits 0 | 30,059 ms |
| hang AFTER a valid agent | **64 ms** | 6,010 ms |
| hang FIRST, so nothing can be skipped | **5,077 ms** | 6,031 ms |
| no hang at all (control) | 81 ms | — |

An earlier version of this section carried 9 ms and 5,011 ms. **Those were measured in a standalone
harness with the timeout hardcoded, not in the shipped code — and the shipped code did not have the
timeout at all.** The edit that was supposed to add it aborted on an unrelated assertion in the same
script and was never applied, while the commit message, this file and the PR comment all said it
had been. Codex caught it in round 3 by reading the file rather than the claim. The numbers above
are from the CLI as it ships.

**Two fixes, and neither is sufficient alone** — which the accident above demonstrated for free: with
only the short-circuit shipped, the hang-first case still hung. The gate asks `firstInstalledAgent`
and stops at the first hit; the probe takes a 5-second timeout and reports a timeout as MISSING. The
doctor keeps probing every row, because it reports every row, so the timeout is its only bound.

`Agent CLIs ✓ claude codex` became `Agent CLI ✓ claude`, naming the one that answered, because
listing them all is what the short-circuit gives up. `npx mulmoterminal init` is the full list and
the line says so.

**And a measurement mistake worth recording**, because it nearly cost a wrong conclusion twice: the
first two attempts to time the gate measured the wrong thing — once because `| head -2` closed the
pipe and ended the timing early, once because the elapsed time included the whole app starting after
the gate had already passed. The `sleep` in the first fake agent was also not on the stripped PATH,
so it exited immediately and the hang never happened. Only the third harness — calling
`firstInstalledAgent` and `installedAgents` directly, with an absolute `/bin/sleep` — measured the
gate.

### The test gap Codex named without calling it a finding

Its TESTS axis said removing the await from `LaunchPanel` alone would stay green, and it was right:
the race spec only covered `startCollectionChat`. A second spec now mounts the real panel with
`/api/agents` still in flight, emits `start` immediately, and asserts the emitted pick is `codex`.
Break-verified: removing either await now reddens one test, and removing the gate's short-circuit
reddens two.

### One CI failure that was mine from the PREVIOUS PR

`test_windows` went red on `copilot-turns.spec.ts` — a test from #2083, already on main. It inserted
261 rows by opening and closing the database once per row, which is unremarkable on macOS and takes
34 seconds on a Windows runner, enough to cross the test timeout. Batched through one connection:
458 ms. Not this PR's code, but this PR's branch cannot go green without it.

## Round 4 — the route answered about the wrong environment

`/api/agents` probed `process.env`, while the spawn's own preflight probes `ptyEnv()`. That is not a
detail: `diagnoseBinary`'s docstring says so in as many words, and `sanitizePtyEnv` strips the
run-script PATH injections — `node_modules/.bin`, npm's node-gyp-bin, yarn's shim dir — so under
`yarn dev` the two genuinely disagree.

Reproduced, after one failed attempt that reproduced nothing: the first try used `codex`, which is
really installed on this machine, so stripping `node_modules/.bin` changed no answer. With a name
this machine does not have, `process.env` says `true` and the spawn's env says `false`. The route
would have advertised an agent the cell then refuses with `SpawnBinaryError` — and the launch form
trusts this route specifically to avoid offering one.

**The first fix was the wrong shape and the suite said so.** Importing `ptyEnv` from `pty-spawn`
made `tool-group-reattach.spec.ts` fail to LOAD — it mocks that module, and the mock has no `ptyEnv`.
A config module reaching into the spawn is the wrong direction. The shared base is now
`inheritedPtyEnv` in `server/infra/pty-env.ts`, called by `ptyEnv` and by the availability probe, so
there is one definition and the two cannot drift.

And the test for it needed a second PATH entry, because an EMPTY path is degenerate: `diagnoseBinary`
answers `ok` for a bare name when there is nowhere to look, which is the "cannot be answered from
here" posture rather than a find.

**The order comment was also false and is fixed.** `AGENT_COMMANDS` order decided nothing when it was
written; since the round-2 short-circuit it decides which agent the gate names and how much latency
an earlier one can add. Reordering is a behaviour change now, and the comment says so.

## The `inheritedPtyEnv` lift, proved rather than argued

The round-4 fix extracted the composition every PTY spawn goes through, so "this behaves the same"
is a claim that has to be RUN. The old composition was copied verbatim into a throwaway harness and
run beside the new function over generated environments — PATH prefixes per delimiter, five locale
shapes, three platforms, launcher variables present and absent: **3,420 environments, 0 mismatches**.

The harness cannot survive (half of it is code that no longer exists), so the two parts that outlive
it were harvested into `test/server/infra/pty-env.spec.ts`: the GENERATOR (which environments matter)
and the PROPERTY (drop OURS from PATH and keep everything else; supply a locale on macOS only when
nothing names one). Break-verified: dropping the locale half reddens 2, dropping the PATH half
reddens 3.

Two things the generator got wrong first, both mine and both worth keeping: a `:`-joined PATH cannot
carry `C:\tools` — it splits at the drive colon — so the pieces are per delimiter; and `/` is KEPT,
because it names no directory of ours, which is what `isLauncherPathEntry` already says. The property
is "drop ours", not "drop anything odd-looking".

## Round 6 — the launcher was EXECUTING binaries the spawn refuses, and the rule changed shape

The round-4 fix made the ROUTE ask with the spawn's environment. The LAUNCHER still probed the raw
PATH — so `npx mulmoterminal` run where a `node_modules/.bin` is on PATH (which yarn/npm run-scripts
and npx itself arrange) **executed that directory's `codex --version` at the gate**. Reproduced with
a fake `codex` that touched a file. `sanitizePtyEnv` exists precisely to keep those entries out of a
spawn; the gate was running one before the server existed.

**This is where the rule changed shape instead of gaining another patch.** Findings 1, 2, 3, 5, 6, 7
and now this one were all the same thing — the launcher's probe disagreeing with the spawn about what
can be started — and six rounds of fixing cases is what this loop's own guidance says to stop doing.
So the launcher now probes with **the PATH the spawn will search**: `searchPathForProbe` strips the
run-script injections, and `hasCommand` takes that environment.

The mirror is pinned as an **equivalence** against the server's own `isLauncherPathEntry`, over
generated entries, rather than by copying its list — `bin/` cannot import it at runtime (plain JS,
before tsx) but a spec can. Break-verified with each mutation asserted to have actually applied:
letting `node_modules/.bin` through reddens 4, letting the yarn shim through 4, `node-gyp-bin` 3,
matching a substring instead of the last segment 5, not stripping at all 2.

**Two of my own verification mistakes, both of which looked like success:**

- The first fix used `path.delimiter`, but this file imports `{ dirname, join, resolve }` — there is
  no `path`. The launcher CRASHED, nothing was executed, and the repro therefore "passed". A test
  that stops the program loading is not a test the program survived, so the re-check ran a control:
  a normal PATH still starts and still finds codex.
- The first mutation sweep's replacements were mangled by shell quoting and never applied, which
  reads exactly like "the tests do not catch this". The sweep now asserts the file CHANGED before
  running and matches its pristine copy after.

## Round 7 — a quoted PATH entry walked past the rule, on BOTH sides

`"C:\p\node_modules\.bin"` — a Windows PATH entry may be written with literal quotes, and
`windowsSearchDirectories` strips them before looking inside. `isLauncherPathEntry` matched the
quoted spelling, so the entry it exists to remove survived by its punctuation and was then searched
anyway.

**The mirror was faithful; the rule underneath was not.** Measured, the launcher and the server both
answered `false` for the quoted form — so fixing only the launcher would have made it stricter than
the server, which is the divergence Codex warned against in round 1. Both now dequote before
matching, and the equivalence pin grew the quoted forms, a `"unterminated` one and `""`.

Break-verified with each mutation asserted to have applied: removing the dequote from either side
reddens 4. The server-side mutation was SKIPPED on the first attempt because prettier had reformatted
the line the pattern was written against — an unapplied mutation reads exactly like a test that does
not catch it, so the pattern count is now printed and asserted.

**And one thing I got wrong in my own favour.** While writing round 7's prompt I found that
`{ ...process.env, PATH: clean }` leaves Windows's `Path` key intact and adds a second one, and
changed it to rewrite path variables in place (`probeEnvFrom`). Codex checked Node's documented
behaviour: duplicate keys are sorted and the uppercase `PATH` wins, so **there was no bug on the
pushed head**. The change stays — rewriting in place is the right shape and now tested against the
server's own answer — but it fixed nothing, and saying it fixed something would have put a false
claim in the record.

## Round 8 — two defects I introduced, and the second one broke a promise this file makes

**The round-7 dequote was Windows semantics applied platformlessly.** `windowsSearchDirectories`
strips a wrapping pair of quotes because Windows does; POSIX does not, and a directory may legally BE
named with quotes there. So the fix removed a PATH entry the POSIX search would have used — new
behaviour for every PTY spawn, not just for the gate. `isLauncherPathEntry`, `sanitizePathEntries`,
`sanitizePtyEnv` and the launcher's mirror all take a platform now, defaulting to `process.platform`,
and dequote only on win32.

The equivalence pin had quietly stopped exercising the case it was added for: it ran on the runner's
own platform, so on macOS the quoted entries were simply `false` on both sides. It now runs both
platforms explicitly.

**And `agentCorrection` did fight the user, in exactly the case this file said it would not.** It
compared VALUES: someone who picked codex and changed back to claude while the answer was in flight
looked identical to someone who had never touched it, and was overwritten. It takes a `touched` FLAG
now, set by the picker and by a watcher on `launchAgent`, and cleared around the correction's own
assignment so the correction does not mark itself.

That one is worth stating plainly because the file's own comment claimed the property. A claim in a
comment is not a test, and the thing that caught it was a reviewer asking what happens when the user
changes their mind twice.

Break-verified, each mutation asserted applied: platformless dequote reddens 6, no dequote at all 4,
dequoting in the launcher only 4, ignoring the touched flag 1.

## Not in this PR

- Telling the user, in the UI, WHICH agents are missing and how to install them. The per-cell
  failure already names the binary and its `<AGENT>_BIN` (`pty-spawn.ts` → `binaryProblemMessage`),
  which is the sentence that matters at the moment it matters.
- Any change to `asTerminalAgent`, `storedCellAgent`, or the `agent ?? "claude"` convention.
