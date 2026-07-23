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
   **Connect (Google sign-in)**. A Google sign-in popup opens — sign in with the
   **same Google account** you'll use on the phone.
2. In **Settings (⚙) → Web Push notifications**, turn on
   **"Notify my devices when a task finishes"** (off by default).

> ⚠️ This is **not** the **Google account** section in Settings (⚙) — that one links a
> Calendar account for tools. Notifications use the **Connect** button in the RemoteHost panel.

That's it — a background task finishing now sends a push to your phone.

> 💡 The login survives a server restart (since 0.9.3): the session is parked in the browser and
> the client silently reconnects on the next page load.

## 2. Phone side (mulmoserver PWA)

The entry point is the same on every phone: **[https://mulmoserver.web.app](https://mulmoserver.web.app)**
(or scan the **QR code** shown in the RemoteHost panel with your phone's camera). Sign in with the
**same Google account** as the terminal — but the steps **differ between iPhone and Android**.

### iPhone / iPad (iOS 16.4+)

On iOS, **Web Push only works from a PWA installed on the Home Screen** — you can't enable it
from a regular Safari tab, so **install first**.

1. Open [https://mulmoserver.web.app](https://mulmoserver.web.app) in Safari.
2. Tap **Share → "Add to Home Screen"** to install the PWA.
3. **Launch it from the Home Screen icon** and sign in with the same Google account as the terminal.
4. Tap **"Enable notifications"** and allow the permission prompt (this registers the device
   as a push target).

### Android

Android (Chrome) can enable push straight from the browser tab.

1. Open [https://mulmoserver.web.app](https://mulmoserver.web.app) in Chrome.
2. Sign in with the same Google account as the terminal.
3. Tap **"Enable notifications"** and allow the permission prompt.
4. (Recommended) Use the menu's **"Add to Home Screen"** to install the PWA — launching and
   delivery are more reliable that way.

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
- **Can't enable on iPhone?** → launch from the **Home Screen icon**, not a Safari tab
  (an iOS restriction).
- **Blocked the permission prompt?** → flip it back to "Allow" in the browser's site settings
  (the icon left of the address bar → Notifications).
- **Different Google accounts** on the terminal and the phone? → sign in to both with the
  same account.
- Getting the **same push twice**? Your phone may have a **stale registration** — re-registering
  on the mulmoserver side clears it.

---

← [Configuration](config.html) / [English guide index](index.html)
