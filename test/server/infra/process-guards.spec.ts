import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { installProcessGuards } from "../../../server/infra/process-guards.js";

// These attach to the real `process`; snapshot and restore so the suite leaves no listeners
// behind (and so the module-level idempotency flag doesn't hide a regression across tests).
describe("installProcessGuards", () => {
  let uncaughtBefore: NodeJS.UncaughtExceptionListener[];
  let rejectionBefore: NodeJS.UnhandledRejectionListener[];
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    uncaughtBefore = process.listeners("uncaughtException");
    rejectionBefore = process.listeners("unhandledRejection");
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Drop only the listeners this suite's install() added, restoring the original set.
    for (const l of process.listeners("uncaughtException")) if (!uncaughtBefore.includes(l)) process.off("uncaughtException", l);
    for (const l of process.listeners("unhandledRejection")) if (!rejectionBefore.includes(l)) process.off("unhandledRejection", l);
    errSpy.mockRestore();
  });

  it("registers one handler for each fatal event", () => {
    installProcessGuards();
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore.length + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(rejectionBefore.length + 1);
  });

  it("is idempotent — a second call adds no further listeners", () => {
    installProcessGuards();
    installProcessGuards();
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore.length + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(rejectionBefore.length + 1);
  });

  it("logs the offending error instead of rethrowing (process stays alive)", () => {
    installProcessGuards();
    const handler = process.listeners("uncaughtException").find((l) => !uncaughtBefore.includes(l));
    if (!handler) throw new Error("guard did not register an uncaughtException handler");
    const boom = new Error("kaboom");
    // The whole point: invoking the handler must NOT throw — that is what keeps the backend
    // (and every terminal on it) alive after an otherwise-fatal error.
    expect(() => handler(boom, "uncaughtException")).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.flat().join(" ")).toContain("kaboom");
  });
});
