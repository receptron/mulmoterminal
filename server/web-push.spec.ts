import { describe, it, expect, vi } from "vitest";
import { buildSendPushBody, parseSendPushResult, sendWebPush } from "./web-push";

describe("buildSendPushBody", () => {
  it("wraps title/body in the onCall `data` envelope", () => {
    expect(JSON.parse(buildSendPushBody("✅ proj", "done"))).toEqual({ data: { title: "✅ proj", body: "done" } });
  });
});

describe("parseSendPushResult", () => {
  it("reads sent/failed/targets from the onCall `result` envelope", () => {
    expect(parseSendPushResult({ result: { sent: 1, failed: 0, targets: 2 } })).toEqual({ sent: 1, failed: 0, targets: 2 });
  });

  it("treats missing / non-number counts as 0", () => {
    expect(parseSendPushResult({ result: {} })).toEqual({ sent: 0, failed: 0, targets: 0 });
    expect(parseSendPushResult({ result: { sent: "x", targets: null } })).toEqual({ sent: 0, failed: 0, targets: 0 });
  });

  it("returns null when the shape isn't a result envelope", () => {
    expect(parseSendPushResult(null)).toBeNull();
    expect(parseSendPushResult({})).toBeNull();
    expect(parseSendPushResult({ result: 5 })).toBeNull();
    expect(parseSendPushResult("nope")).toBeNull();
  });
});

describe("sendWebPush", () => {
  it("no-ops (returns null, never fetches) when RemoteHost isn't signed in", async () => {
    // In tests the remote-host Firebase auth has no currentUser (never connected), so a
    // push must be skipped entirely — a failed/absent auth must not throw or hit the network.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await sendWebPush("✅ proj", "done")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
