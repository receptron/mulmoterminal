# fix: loopback hook POSTs must not go through an inherited proxy (#2253)

## Problem

curl honours `http_proxy` / `ALL_PROXY` even for `localhost` and `127.0.0.1` (measured on curl 8.7.1). Proxy variables reach every agent pane (`sanitizePtyEnv` keeps them), so with one set the claude hook, the rate-limit status line and copilot's hook send their POST, including prompts and tool input, to the proxy, and the cell's status never updates.

The codex hook got the same fix in #2250.

## Change

Add `--noproxy <host>` to the three curl commands, using the host each one already posts to:

- `server/session/hook-settings.ts` — `hookCommand`
- `server/agents/statusline.ts` — `statusLineCommand`
- `server/agents/copilot-hooks-file.ts` — the `bash` command

A spec helper runs a command through `/bin/sh` under `http_proxy` / `ALL_PROXY` and reports whether the target or the proxy received it. Each site gets a case.

## Out of scope

Copilot's `powershell` variant: `Invoke-WebRequest -NoProxy` is PowerShell 7 only and fails on 5.1, and the variant has never been run on Windows.
