// Shared (firestore-backed) collections — MulmoTerminal is their host.
//
// WHY HERE AND NOT IN MulmoClaude. A shared collection's roster lives in one
// `app.json` per repository, so the unit of sharing is a project directory.
// MulmoClaude is a single managed workspace holding unrelated collections side
// by side, where one `app.json` would put a client list and a set of blood-test
// results under the same roster; it therefore declares no support and unbound
// its accessor (mulmoclaude#2870). MulmoTerminal's roots ARE repositories, so
// the capability is declared here.
//
// TWO SEAMS, NOT ONE. `setSharedCollectionsSupport` answers "does this host
// serve shared collections AT ALL" and is fixed for the process;
// `setFirestoreAccessor` answers "is there a session RIGHT NOW" and comes and
// goes with the remote-host connection. Deriving the first from the second
// would make a schema INVALID whenever nobody is signed in — the acceptance
// gate would refuse it, and the author would be told their collection is
// misconfigured because they happened to be disconnected.
import { setFirestoreAccessor, setSharedCollectionsSupport, type FirestoreDocs } from "@mulmoclaude/core/collection/server";
// The adapter is the one collection module that pulls the firebase SDK in at
// runtime; it ships from its own subpath so the optional peer stays optional.
import { createFirestoreDocs } from "@mulmoclaude/core/collection/firestore";
import type { Firestore } from "firebase/firestore";
import { currentEmail, currentFirestore, currentUid } from "./remoteHost/session.js";

// One adapter per Firestore instance. The accessor runs on every store call and
// the session's Firestore changes on each (re)connect, so cache on identity
// rather than allocating a closure set per read.
let cached: { firestore: Firestore; docs: FirestoreDocs } | null = null;

function docsFor(firestore: Firestore): FirestoreDocs {
  if (cached?.firestore !== firestore) cached = { firestore, docs: createFirestoreDocs(firestore) };
  return cached.docs;
}

export function initSharedCollections(): void {
  setSharedCollectionsSupport(true);
  setFirestoreAccessor(() => {
    const uid = currentUid();
    const email = currentEmail();
    // No session, or a session with no verified address to match the roster
    // against: null, which the store turns into "connect remote-host first"
    // rather than an empty collection.
    if (uid === null || email === null) return null;
    return { docs: docsFor(currentFirestore()), email, uid };
  });
}
