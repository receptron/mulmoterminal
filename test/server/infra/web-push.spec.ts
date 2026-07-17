import { describe, it, expect, vi } from "vitest";
import { sendWebPush } from "../../../server/infra/../../server/infra/web-push";

// The envelope/parse/timeout logic is unit-tested in @mulmobridge/web-push; here we only
// verify the wiring — that our RemoteHost token provider is injected into the shared sender.
describe("sendWebPush (wiring)", () => {
  it("no-ops (returns null, never fetches) when RemoteHost isn't signed in", async () => {
    // With no RemoteHost session, currentIdToken yields null, so the shared sender must skip
    // the network entirely — a failed/absent auth must not throw or hit the wire.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await sendWebPush("✅ proj", "done")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
