# fix: sandbox "doesn't connect" when the image isn't built (auto-build + ship Dockerfile)

## Report

"docker 利用で繋がらない" — a tester's Docker sandbox wouldn't connect. Root cause: the
`mulmoterminal-sandbox` image wasn't present on their machine.

## Diagnosis

- The image IS defined in this repo (`Dockerfile.sandbox`; verified its entrypoint/workdir
  differ from mulmoclaude's `mulmoclaude-sandbox`, which is NOT interchangeable).
- But it was **manual-build only** (no auto-build) AND **not shipped** in the npm package
  (`files` excluded it) — so npm installs couldn't build it at all.
- `dockerAvailable()` only checked the daemon (`docker info`), not image presence, so the
  sandbox gate passed and `docker run` failed with a cryptic "Unable to find image …"
  (`exit 125`) shown raw in the terminal → "doesn't connect", no clear message.

## Fix (`server/sandbox.ts`, `server/index.ts`, `package.json`)

1. Ship `Dockerfile.sandbox` in `package.json` `files`.
2. `ensureSandboxImage()`: build the image if missing or the Dockerfile changed (sha256
   tracked in an image label). Runs once at startup; `--load`; tiny secret-free build
   context (the Dockerfile COPYs nothing). Resolves the Dockerfile relative to the package
   (`<pkg>/Dockerfile.sandbox`), so it works in dev and npm installs.
3. Gate: `... && dockerAvailable() && sandboxImageExists()` — a missing image now falls
   back to the host spawn instead of a cryptic `docker run` error; startup logs the state.

Closes the #202 follow-up "auto-build the sandbox image".

## Verification

- Booted with a throwaway missing image name → auto-built (`679MB`, sha-labelled) →
  session connects (authenticated Claude UI). Re-boot with the cached image → instant, no
  rebuild. Throwaway image removed; real image intact.
- `npm pack --dry-run` now includes `Dockerfile.sandbox`.
- `format`/`lint`/`typecheck`/`typecheck:server`/`build`/`test` green (+ a test asserting
  the Dockerfile is in `files`).
