---
title: Spread your work across several Claude subscriptions automatically (beta)
nav_title: Token rotation (beta)
layout: default
parent: English
nav_order: 17.5
description: Register several Claude subscriptions once, and MulmoTerminal picks the one with the most room every time a session starts — and moves a session to another one when it is about to hit its limit, without losing the conversation.
---

# Token rotation (beta)
{: .no_toc }

Heavy use of Claude Code can spend a week's allowance in a day. With several subscriptions, the usual
answer is to switch with `/login` by hand. Token rotation does that for you: each new session starts on
the subscription with the most room, and a session that is about to run out moves to another one and
carries on with the same conversation.

**The one thing to remember, if you use Claude Code hard:** when a session hits its usage limit, open the
cell's **Tools** menu and choose **Restart the agent**. The session starts again on a subscription that
still has room, on the **same conversation**. No `/login`, no signing out and in, no new conversation —
and nothing to do at all until you actually hit a limit.

1. TOC
{:toc}

## When a session hits its limit: restart the agent

Most of the time you do nothing: a session moves by itself when its subscription reaches 98%
(see [When a subscription runs low](#when-a-subscription-runs-low)). But the usage figures can be a few
minutes old, so a session can hit the limit first and stop with Claude Code's own limit message. Then:

1. In that cell's header, open **Tools**.
2. Choose **Restart the agent**.

![The Tools menu in a cell header, with Restart the agent at the bottom](../images/token-rotation-restart-agent.png)

The agent ends and starts again on the same conversation. Because a subscription is picked every time a
process starts, the new process lands on the one with the most room — the header names it. The message
that hit the limit was not re-sent: send it again.

If every subscription is out, the restart picks one anyway and you see Claude Code's limit message again;
wait for the first reset shown in [Token usage](#token-usage).

## How it differs from accounts

[Accounts](accounts.html) give each subscription its own config directory, so a conversation started on
one stays on it. Token rotation keeps **one** directory (`~/.claude`) and changes only the credential, so
every conversation can continue on any subscription — the same as switching with `/login`, done for you.

## Setting it up

1. **Make a token for each subscription.** In your own terminal, run `claude setup-token` and sign in
   with that subscription in the browser. It prints a long token starting with `sk-ant-oat01-`.
2. **Keep the token in the macOS keychain**, one item per subscription:

   ```sh
   security add-generic-password -a mulmoterminal -s mulmoterminal-token-personal -w
   ```

   With nothing after `-w` it asks for the value, so the token never lands in your shell history. Never
   paste a token into a chat or into `config.json`. Not on a Mac? Put it in a file instead, `chmod 600`
   it, and use `"file"` below — a file anyone else can read is refused.
3. **Add `tokenRotation` to `~/.mulmoterminal/config.json`:**

   ```json
   "tokenRotation": {
     "enabled": true,
     "includeDefaultLogin": false,
     "tokens": [
       { "id": "personal", "label": "Personal", "email": "me@example.com", "keychain": "mulmoterminal-token-personal" },
       { "id": "work", "label": "Work", "email": "me@work.example", "keychain": "mulmoterminal-token-work" }
     ]
   }
   ```

   `email` is only for you: it is shown beside that subscription so you can tell which is which.
4. **Settings → "Reload config file"** (no restart needed).
5. **Open a new cell**, or close a cell and reopen its conversation. That is when a subscription is picked.

The `mulmoterminal-model` skill walks you through all of this if you ask it to "rotate my subscriptions".

## Should the `/login` account be included?

`includeDefaultLogin: true` adds the account you are signed into with `/login` as one more candidate.
Once **every** subscription is registered as a token, set it to `false`: the `/login` account is always
one of them, so it would be counted twice — and which one it is changes whenever you `/login` again.

## How a subscription is chosen

By the 7-day window: **what is left, divided by the hours until it resets.** Room that is about to reset
is used first, because it is lost at the reset; a subscription with a full week ahead waits. Over a week
that keeps every subscription's window draining as evenly as possible.

Sessions already running on a subscription share it: its figure is divided by one plus the number of
sessions running there, so several cells opened together spread over several subscriptions instead of
all landing on the most urgent one.

A subscription is skipped when its 5-hour window is at 90% or more, or its week is at 98% or more.

## When a subscription runs low

- **At 98%**: when a session finishes a turn on a subscription whose 5-hour or weekly window is at 98%
  or more, it moves to another one there and then — between turns, so nothing is cut off.
- **If it hits the limit anyway** (the usage figures are a few minutes old): Claude Code reports the
  hit, and the session moves at once.

Either way the cell reconnects by itself and resumes the same conversation, with one line saying what
happened:

```
[mulmoterminal] Personal (me@example.com) is close to its usage limit — continuing this conversation on Work.
```

The message that hit the limit is **not** re-sent; send it again. If every other subscription is out
too, the session stays where it is, with Claude Code's own limit message.

## What you will see

- **The cell's header** names the subscription it runs on, with the same mark accounts use.
  Click it to move that session to another subscription yourself: pick one from the list and the
  session restarts on it, on the same conversation. A turn in progress is stopped. The list holds the
  subscriptions in your config, plus the `/login` one when `includeDefaultLogin` is on.
  Each shows how much of its weekly allowance is left, and how long until that window resets, taken from the same readings as the toolbar gauge
  (so it is blank until those have been measured, and "At its limit" when it is out).
- **The toolbar's usage gauge** gets one entry per subscription; hover it for the name and address.
  A subscription that is out of its allowance shows `at limit` in the warning colour instead of
  figures; hover it for when its windows were last due to reset. The `/login` account's own figures
  are labelled `/login`, so they cannot be read as a second copy of a token's.
- **"More features" → "Token usage"** lists every subscription with what is left of its 5-hour and
  weekly windows and when each resets. It is in the menu only while token rotation is on.

## Token usage

**More features → Token usage** shows every subscription you registered under `tokenRotation` at once (the `/login` account is not listed): what is left of its 5-hour and weekly
windows, and when each resets. Open it when you want to know *why* a session landed where it did, or
which subscription comes back first after a limit.

![More features menu with Token usage at the bottom](../images/token-rotation-more-features.png)

![The Token usage screen: each rotation token with what is left of its 5-hour and weekly windows (names replaced)](../images/token-rotation-usage.png)

- A bar is what is **left**, not what is spent. A short bar is a subscription running dry.
- The reset time is what the picker weighs: room about to reset is used first.
- It is in the menu only while token rotation is on. The toolbar's usage gauge has the same figures in
  small, one entry per subscription.

## When the subscription changes

A subscription is picked when a session's **process starts**: a new cell, reopening a closed
conversation, the restart button, or a move at the limit. Reloading the browser or a dropped
connection reattaches the process that is already running and changes nothing.

## Which cells rotate

Plain Claude cells only. A cell on a provider, a custom agent or an [account](accounts.html) already
says whose subscription it runs on and is never rotated.

## Checking it works

- In a rotated cell, `/status` shows `Auth token: CLAUDE_CODE_OAUTH_TOKEN`.
- The account Claude Code itself names (in `/status` and elsewhere) can still be your `/login` one. That
  is only what it read from its own settings; the usage is counted against the subscription the cell's
  header names.
- A token that cannot be read is skipped, with a warning naming the entry (never the token) in the
  server log.

Whether rotating several subscriptions suits Anthropic's terms is yours to check.
