// @vitest-environment node
import { describe, it, expect } from "vitest";
import { RemoteHostSessionExpiredError, reconnectErrorStatus, verifiedEmailOf } from "./session.js";

describe("reconnectErrorStatus", () => {
  it("maps an expired/invalid session to 401 (client drops the blob)", () => {
    expect(reconnectErrorStatus(new RemoteHostSessionExpiredError())).toBe(401);
  });

  it("maps a transient failure to 500 (client keeps the blob for retry)", () => {
    expect(reconnectErrorStatus(new Error("firestore unavailable"))).toBe(500);
    expect(reconnectErrorStatus("network down")).toBe(500);
    expect(reconnectErrorStatus(undefined)).toBe(500);
  });
});

describe("verifiedEmailOf", () => {
  it("hands back the address of a verified user", () => {
    expect(verifiedEmailOf({ email: "owner@example.com", emailVerified: true })).toBe("owner@example.com");
  });

  it("answers null for an unverified address — the rules deny it every document anyway", () => {
    // `listedIn()` in firestore.rules is guarded by `verified()`, so an unverified
    // address matches no roster entry. Reporting it as a principal would open the
    // pane and fail every row instead of saying there is nothing to act on.
    expect(verifiedEmailOf({ email: "owner@example.com", emailVerified: false })).toBeNull();
  });

  it("answers null with no session and with no address", () => {
    expect(verifiedEmailOf(null)).toBeNull();
    expect(verifiedEmailOf({ email: null, emailVerified: true })).toBeNull();
  });
});
