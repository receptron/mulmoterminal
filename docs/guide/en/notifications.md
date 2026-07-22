---
title: Mobile notifications (Web Push)
layout: default
parent: English
nav_order: 6
---

# Mobile notifications (Web Push)
{: .no_toc }

- TOC
{:toc}

**When a background task finishes, your phone gets a push notification.** Kick off a long task,
walk away, and get pulled back when it's done. Setup is in two places: the **terminal side** and
the **phone side**.

- You're only notified for **sessions you're *not* looking at** (the pane you're actively viewing
  stays quiet — same idea as the attention [sound](features.html)).
- The send happens on the server; device registration/delivery is handled by a separate service
  (`mulmoserver`). Pushes are sent **only while RemoteHost is connected**.

---

## 1. Terminal side (mulmoterminal)

1. Open the **📱 RemoteHost** control in the toolbar (`phonelink` icon) and click
   **Connect (Google sign-in)**. Sign in with the **same Google account** you'll use on the phone.
2. In **Settings (⚙) → Web Push notifications**, turn on
   **"Notify my devices when a task finishes"** (off by default).

That's it — a background task finishing now sends a push to your phone.

> 💡 The login survives a server restart (since 0.9.3): the session is parked in the browser and
> the client silently reconnects on the next page load.

## 2. Phone side (mulmoserver PWA)

1. On your phone's browser, open **[https://mulmoserver.web.app](https://mulmoserver.web.app)**
   (or scan the **QR code** shown in the RemoteHost panel).
2. Sign in with the **same Google account** as the terminal.
3. **Enable notifications** (registers this device as a push target).
4. **Add to Home Screen** (install the PWA) for more reliable delivery.

---

## When a push is sent

- ✅ RemoteHost is **connected** on the terminal side
- ✅ the **"Notify my devices…" toggle is ON**
- ✅ at least one **device has notifications enabled** on the phone side
- ✅ the finished session was **one you weren't viewing** (a background session)

## If nothing arrives

- Did you finish a task in the **pane you were watching**? → try a background session instead.
- Is **RemoteHost disconnected**? → Connect again.
- Notifications not enabled / no device registered on the phone. → enable them in the PWA.
- Getting the **same push twice**? Your phone may have a **stale registration** — re-registering
  on the mulmoserver side clears it.

---

← [Configuration](config.html) / [English guide index](index.html)
