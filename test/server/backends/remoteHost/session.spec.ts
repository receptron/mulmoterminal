import { describe, it, expect } from "vitest.js";
import { RemoteHostSessionExpiredError, reconnectErrorStatus } from "../../../../server/backends/remoteHost/session.js";

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
