# chore: drop the psmux-only scrub list now that the shared rule covers its one name

`PSMUX_SCRUBBED_NAMES` held one name, Volta's `_VOLTA_TOOL_RECURSION`, and was applied only to a psmux
client and a running psmux server. #3233 put the same name under `isLauncherEnvVar`, which
`sanitizePtyEnv` (the spawn's client environment) and `isScrubbedGlobalEnvEntry` (the running-server
scrub) both read for every multiplexer. The psmux list took nothing the shared rule does not.

Removed: `PSMUX_SCRUBBED_NAMES`, `tmuxPsmuxScrubbedNames`, and the `extraNames` parameter of
`isScrubbedGlobalEnvEntry`, which only that list ever filled.

Not changed: what gets scrubbed. The old and new decisions were run side by side over generated
names (every case spelling of the marker, neighbours, other platforms, psmux on and off) for the client
environment and for the running-server decision, and they agree. The harness is not kept, since half of
it is the removed code; the permanent coverage is the existing specs for `sanitizePtyEnv`,
`isScrubbedGlobalEnvEntry` and the startup scrub on a running psmux.
