// @vitest-environment node
//
// MulmoTerminal is the host for shared (firestore-backed) collections, and the
// binding is two separate seams: a capability that is fixed for the process,
// and a session that comes and goes. Getting those two confused is what this
// pins — deriving the capability from the session would make a schema INVALID
// while nobody is signed in, so the author would be told their collection is
// misconfigured because they happened to be disconnected.
import { describe, it, expect, beforeEach, vi } from "vitest";

const session = { uid: null as string | null, email: null as string | null };
// One STABLE instance: the real session hands back the same Firestore until it
// reconnects, and the adapter cache is keyed on that identity.
const firestore = { __fake: "firestore" };

vi.mock("../../../server/backends/remoteHost/session.js", () => ({
  currentUid: () => session.uid,
  currentEmail: () => session.email,
  currentFirestore: () => firestore,
}));
// The adapter is the one module that pulls the firebase SDK in at runtime.
vi.mock("@mulmoclaude/core/collection/firestore", () => ({
  createFirestoreDocs: (firestore: unknown) => ({ __docsFor: firestore }),
}));

const { initSharedCollections } = await import("../../../server/backends/sharedCollections.js");
const { hostSupportsSharedCollections, firestoreHandle, setSharedCollectionsSupport, setFirestoreAccessor } =
  await import("@mulmoclaude/core/collection/server");

describe("shared collections host binding", () => {
  beforeEach(() => {
    session.uid = null;
    session.email = null;
    setSharedCollectionsSupport(false);
    setFirestoreAccessor(null);
  });

  it("declares the capability, so a firestore schema is acceptable at all", () => {
    expect(hostSupportsSharedCollections()).toBe(false);
    initSharedCollections();
    expect(hostSupportsSharedCollections()).toBe(true);
  });

  it("keeps the capability while there is no session", () => {
    // The distinction the two seams exist for: signed out is "connect first",
    // not "this schema is invalid".
    initSharedCollections();
    expect(firestoreHandle()).toBeNull();
    expect(hostSupportsSharedCollections()).toBe(true);
  });

  it("hands back the signed-in principal once a session is open", () => {
    initSharedCollections();
    session.uid = "uid_owner";
    session.email = "owner@example.com";
    const handle = firestoreHandle();
    expect(handle?.uid).toBe("uid_owner");
    expect(handle?.email).toBe("owner@example.com");
  });

  it("answers null for a session with no address — the roster is keyed by email", () => {
    // A uid alone cannot be matched against `members`, and guessing an address
    // would be a permission decision made on a fabricated identity.
    initSharedCollections();
    session.uid = "uid_owner";
    session.email = null;
    expect(firestoreHandle()).toBeNull();
  });

  it("reuses one adapter per Firestore instance", () => {
    initSharedCollections();
    session.uid = "uid_owner";
    session.email = "owner@example.com";
    expect(firestoreHandle()?.docs).toBe(firestoreHandle()?.docs);
  });
});
