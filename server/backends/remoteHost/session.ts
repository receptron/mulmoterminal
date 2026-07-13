// Firebase session for MulmoTerminal's remote-host runner, backed by the export/
// seed-able session controller in `@mulmoclaude/core/remote-host/server` so a
// server restart doesn't drop the session — the browser parks it in localStorage
// and hands it back on reconnect (case A', mulmoserver#50).
//
// The controller opens a FRESH Firebase app per (re)connect (initializeAuth reads
// persistence once), so `auth`/`firestore`/`storage` change each time. This module
// holds the current handles and exposes them as getters, so the runner, onExpire,
// and attachment ingest always target the live session's Firestore/Storage/uid
// rather than a stale module-level instance.
import { createRemoteHostAuth, createRemoteHostSession, isSeedableBlob, type RemoteHostSessionHandles } from "@mulmoclaude/core/remote-host/server";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

import { firebaseConfig } from "./firebase.js";

const session = createRemoteHostSession(firebaseConfig);
let handles: RemoteHostSessionHandles | null = null;

// A parked blob that Firebase restored to no valid user (expired refresh token,
// revoked session). Distinct from transient/init failures so the route can answer
// 401 (client drops the blob) instead of 5xx (client keeps it).
export class RemoteHostSessionExpiredError extends Error {
  constructor() {
    super("remote-host session could not be restored");
    this.name = "RemoteHostSessionExpiredError";
  }
}

// Map a reconnect failure to an HTTP status: 401 for a genuinely expired/invalid blob
// (the client drops the parked session), 500 for a transient failure (the client keeps
// it and can retry later — a blip must not force a re-login).
export const reconnectErrorStatus = (err: unknown): 401 | 500 => (err instanceof RemoteHostSessionExpiredError ? 401 : 500);

const uidOf = (opened: RemoteHostSessionHandles): string => {
  const uid = opened.auth.currentUser?.uid;
  if (!uid) throw new Error("remote-host session opened without an authenticated user");
  return uid;
};

// Fresh connect: open a clean session and sign in with the browser-minted Google
// OAuth ID token. The sign-in runs as the session's `validate` step, so a bad
// token rolls the fresh app back and leaves any live session untouched. Resolves
// to the authenticated uid.
export const signIn = async (idToken: string): Promise<string> => {
  const next = await session.open(undefined, async (opened) => {
    await createRemoteHostAuth(opened.auth).signInHost(idToken);
  });
  handles = next;
  return uidOf(next);
};

// Popup-free reconnect: open the session seeded from the browser-parked blob,
// validating (before any teardown) that it restored a real user. Both a malformed
// blob and one that yields no user reject with RemoteHostSessionExpiredError —
// neither can ever restore a session, so the client is told (401) to drop it;
// genuine transient failures propagate as-is (5xx, blob kept). Reconnect stays
// non-destructive either way.
export const restore = async (blob: string): Promise<string> => {
  if (!isSeedableBlob(blob)) throw new RemoteHostSessionExpiredError();
  const next = await session.open(blob, (opened) => (opened.uid ? Promise.resolve() : Promise.reject(new RemoteHostSessionExpiredError())));
  handles = next;
  return uidOf(next);
};

// Tear the local session down even if the Firebase sign-out throws: otherwise
// `handles`/`currentUid` would stay stale and the app would leak while the route
// answered 500. The sign-out error still propagates after cleanup.
export const signOut = async (): Promise<void> => {
  try {
    if (handles) await createRemoteHostAuth(handles.auth).signOutHost();
  } finally {
    handles = null;
    await session.close();
  }
};

const requireHandles = (): RemoteHostSessionHandles => {
  if (!handles) throw new Error("remote-host session is not open");
  return handles;
};

export const currentUid = (): string | null => handles?.auth.currentUser?.uid ?? null;
export const currentFirestore = (): Firestore => requireHandles().firestore;
export const currentStorage = (): FirebaseStorage => requireHandles().storage;

// A fresh Firebase ID token for the live session (for calling authed backends such
// as the sendPush Cloud Function), or null when disconnected. getIdToken refreshes
// on demand, so this is valid as long as the session is open.
export const currentIdToken = (): Promise<string | null> => handles?.auth.currentUser?.getIdToken() ?? Promise.resolve(null);

// The blob the browser parks (refresh token included). Null when disconnected.
export const exportSession = (): string | null => session.exportSession();
