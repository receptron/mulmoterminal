---
title: Run the server on another machine (SSH, Docker)
layout: default
parent: English
nav_order: 22
description: Run MulmoTerminal on a Linux box, a VPS or in Docker, and use it from your laptop's browser through an SSH tunnel.
---

# Run the server on another machine
{: .no_toc }

- TOC
{:toc}

MulmoTerminal is one server (Express, the terminals, tmux and the agents' CLIs) and a web page it
serves. The server does not have to run on the machine your browser is on: put it on a Linux box, a
VPS or a container, and reach it from your laptop through an **SSH tunnel**. The agents then run —
and keep running — over there.

This is a **first cut**. It has been run end to end once (a Linux container, reached through
`ssh -L`), and the parts nobody has tried yet are marked as such below. If you use it, please say
how it went on [issue #2669](https://github.com/receptron/mulmoterminal/issues/2669) — that is how
the next version gets decided.

## Why a tunnel, and not an open port

The server has **no login**. It listens on `127.0.0.1` only, so nothing outside the machine can
reach it. An SSH tunnel keeps it that way: your laptop's `localhost:34567` is carried to the
server's `127.0.0.1:34567` over SSH, and to the server the connection comes from itself. Nothing
has to be opened in a firewall, and nothing about the server's settings changes.

## On the server

You need what a local install needs ([Getting started](getting-started.html)): Node.js 24.15 or
newer, `git`, `gh`, and the agent CLIs you use (`claude`, `codex`, …). `tmux` is optional but
worth having: with it, terminals survive the server restarting and your laptop disconnecting.

Log in over SSH and start it:

```bash
ssh you@server
npx mulmoterminal@latest
```

Started over SSH, it opens no browser on the server, and prints the tunnel command to run on your
own machine:

```text
[mulmoterminal] Started over SSH, so no browser is opened here. On your own machine, run:
[mulmoterminal]   ssh -N -L 34567:127.0.0.1:34567 you@<this-host>
[mulmoterminal] then open http://localhost:34567 there.
```

To keep it running after you log out, start it inside `tmux` (or `screen`, or a service manager),
and stop it with `npx mulmoterminal stop`.

## On your laptop

```bash
ssh -N -L 34567:127.0.0.1:34567 you@server
```

Then open **http://localhost:34567** in your browser. Close and reopen the tunnel at will: the
terminals keep running on the server, and the page reattaches to them.

- If `34567` is taken on your laptop (a local MulmoTerminal, say), forward another local port:
  `ssh -N -L 34599:127.0.0.1:34567 you@server`, then open `http://localhost:34599`.
- Add **`-A`** (`ssh -A -N -L …`) to let the agents `git push` with the keys on your laptop,
  without copying them to the server. **Only to a server you trust**: while the connection is open,
  anyone with root on it — or your own account there — can use your laptop's keys to sign in
  wherever they work. On a shared or untrusted box, give the server its own deploy key instead.

## Logging the agents in on the server

The agents run on the server, so they need their own logins there. None of them needs a browser
on the server.

| What | How |
|---|---|
| **Claude Code** | Run `claude` once — in a Shell cell, or over SSH. With no browser on the server it prints a sign-in URL ("Browser didn't open? Use the url below to sign in") and waits for a code: open the URL on your laptop, sign in, and paste the code back. On Linux the login is kept in a file under `~/.claude`, so it lasts. |
| **GitHub (`gh`)** | `gh auth login`, choose the web browser, and enter the one-time code it shows at `github.com/login/device` on your laptop. MulmoTerminal's own PR and issue views use this login too. |
| **`git push`** | `ssh -A` from your laptop (above — a trusted server only), or keys / a credential helper set up on the server. |
| **Codex** | Run `codex` once and choose **Sign in with Device Code**: open `https://auth.openai.com/codex/device` on your laptop, sign in, and enter the one-time code it shows (it expires in 15 minutes). |

In the trial runs the Claude Code sign-in URL and the Codex device code were seen on a headless
Linux box; neither sign-in was completed there.

## In Docker

There is no official image yet. This `Dockerfile` is an example — it was built and run for this
guide (Node 24, `git`, `gh`, `tmux`, Claude Code; add the other agents you use):

```dockerfile
FROM node:24-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux curl ca-certificates \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g mulmoterminal @anthropic-ai/claude-code
RUN useradd -m dev && mkdir -p /home/dev/work && chown -R dev:dev /home/dev
USER dev
WORKDIR /home/dev/work
# Published on the host's 127.0.0.1 only (see `docker run` below); the bind has to be wide inside.
ENV MULMOTERMINAL_HOST=0.0.0.0
EXPOSE 34567
CMD ["mulmoterminal", "--no-open"]
```

Build it, and run it published on your machine's `127.0.0.1` only:

```bash
docker build --pull -t mulmoterminal-server .
docker run -p 127.0.0.1:34567:34567 -v "$HOME/work:/home/dev/work" mulmoterminal-server
```

- `MULMOTERMINAL_HOST=0.0.0.0` (set in the `Dockerfile` above) is needed so the published port reaches the server inside the
  container. It prints a `[security]` warning — expected: the port is published on `127.0.0.1`
  only, so it is still reachable from your machine alone. See
  [Configuration](config.html) for what that setting allows.
- Give the container the agents' logins as **volumes**, not baked into the image — `~/.claude`,
  `~/.claude.json`, `~/.codex`, `~/.config/gh`, `~/.gitconfig`, and `~/.mulmoterminal` for
  MulmoTerminal's own state.
- On a remote Docker host, combine the two: publish on the host's `127.0.0.1`, and tunnel to the
  host with `ssh -L`.

## What works differently

Everything in the grid works: terminals, tmux reattach, worktrees, the PR and issue views,
clipboard, sounds, pasting screenshots, and dropping files in Chrome (the file is uploaded to the
server). A few actions act on **the server's machine**, not yours:

| Action | On a Linux server with no screen | On a remote Mac |
|---|---|---|
| Reveal in the file manager, open with the OS app | Fails with an error | Opens on the **remote** screen |
| The file dialog ("Insert a file path") | Fails with an install hint | Opens on the **remote** screen |
| Voice input | Not offered (it needs the Mac-only transcriber) | Transcribes on the server |
| Dropping a file in Safari or Firefox | Inserts **your laptop's** path, which the server does not have | Same |
| `localhost:<port>` links on a worktree's `env` chip | Open on your laptop — forward that port too | Same |
| Linking Google Calendar | The sign-in redirect lands on your laptop, not the server | Same |

## Experimental: tell it the server is remote

Nothing can tell from the server that your browser is elsewhere — through a tunnel the connection
comes from the server itself. So say it: tick **Settings → Sessions and background tasks →
Experimental: the server runs on another machine**, or write it in the **server's**
`~/.mulmoterminal/config.json`:

```json
{ "remoteServer": true }
```

Then the actions in the table above that would act on the server's screen are withheld: the path
menu's *Insert a file path* and *Reveal in the file manager* and the launch form's folder button
are hidden, the same actions from a header button, a key or the Files pane say why instead, and a
dropped file is always uploaded rather than inserted as your laptop's path. The launcher opens no
browser on the server even when it was not started over SSH (a service, say), and Settings' Google
sign-in says to run `npx mulmoterminal google login` on the server instead. The Settings box takes
effect at once; after editing the file by hand, restart the server. This is an experiment — say how it went on
[issue #2669](https://github.com/receptron/mulmoterminal/issues/2669).

## Developing MulmoTerminal against a remote server

The server and the page can also be run apart: `yarn dev:server` on the server (Express only), and
`yarn dev:client` on your laptop (Vite only), with the tunnel on `34567` open — Vite forwards
`/api` and `/ws` to `localhost:34567`, which the tunnel carries to the server. If the server listens
on another port, give the client the same one: `PORT=<port> yarn dev:client`.
