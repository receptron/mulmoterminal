import { describe, it, expect } from "vitest";
import { hasErrnoCode, messageOf } from "../../server/errors.js";

describe("messageOf", () => {
  it("takes the message off an Error", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });

  it("keeps a subclass's message", () => {
    expect(messageOf(new TypeError("bad type"))).toBe("bad type");
  });

  // Anything can be thrown, and the result goes straight into a log line.
  it("stringifies a non-Error throw", () => {
    expect(messageOf("just a string")).toBe("just a string");
    expect(messageOf(42)).toBe("42");
    expect(messageOf(null)).toBe("null");
    expect(messageOf(undefined)).toBe("undefined");
  });

  it("does not throw on an object with no message", () => {
    expect(messageOf({ code: "ENOENT" })).toBe("[object Object]");
  });
});

describe("hasErrnoCode", () => {
  it("accepts an fs error carrying a code", () => {
    const err = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect(hasErrnoCode(err)).toBe(true);
    if (hasErrnoCode(err)) expect(err.code).toBe("ENOENT");
  });

  // The guard only narrows to "could have a code" — callers still compare the value.
  it("accepts any object, since a code may simply be absent", () => {
    expect(hasErrnoCode(new Error("no code"))).toBe(true);
    expect(hasErrnoCode({})).toBe(true);
  });

  it("rejects null and primitives, which would throw on property access", () => {
    expect(hasErrnoCode(null)).toBe(false);
    expect(hasErrnoCode(undefined)).toBe(false);
    expect(hasErrnoCode("ENOENT")).toBe(false);
    expect(hasErrnoCode(42)).toBe(false);
  });
});
