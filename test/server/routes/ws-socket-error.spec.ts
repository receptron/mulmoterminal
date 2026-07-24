// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";

import { attachSocketErrorLogger } from "../../../server/routes/ws-routes.js";

describe("attachSocketErrorLogger", () => {
  it("keeps an 'error' emitted on the socket from crashing the process", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A bare EventEmitter reproduces the crash: emitting 'error' with NO listener throws
    // (Node re-raises it), which is exactly what would take down the backend.
    const ws = new EventEmitter();
    expect(() => ws.emit("error", new Error("ECONNRESET"))).toThrow(/ECONNRESET/);

    attachSocketErrorLogger(ws as unknown as WebSocket, "claude");
    // With the listener attached the same emit is absorbed and merely logged.
    expect(() => ws.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("socket error (claude)"));
    expect(warn.mock.calls.flat().join(" ")).toContain("ECONNRESET");
    warn.mockRestore();
  });
});
