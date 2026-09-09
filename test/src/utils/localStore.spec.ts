// Storage that throws is not an edge case: a browser with site data blocked throws on the ACCESS,
// so a module reading a preference at load time would fail to load at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readStored, writeStored } from "../../../src/utils/localStore";

const throwing = {
  getItem: (): string => {
    throw new Error("The operation is insecure.");
  },
  setItem: (): void => {
    throw new Error("The operation is insecure.");
  },
};

describe("localStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads and writes an ordinary store", () => {
    writeStored("mt-test-key", "value");
    expect(readStored("mt-test-key")).toBe("value");
    localStorage.removeItem("mt-test-key");
  });

  it("answers null instead of throwing when the store is unavailable", () => {
    vi.stubGlobal("localStorage", throwing);
    expect(readStored("mt-test-key")).toBeNull();
  });

  it("swallows a write the store refuses", () => {
    vi.stubGlobal("localStorage", throwing);
    expect(() => writeStored("mt-test-key", "value")).not.toThrow();
  });

  it("answers null for a key nothing wrote", () => {
    expect(readStored("mt-nothing-wrote-this")).toBeNull();
  });
});
