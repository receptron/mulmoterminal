import { describe, it, expect } from "vitest";
import { relayDestKey } from "../../../src/composables/relayDest";

// #3506. The source's server keeps a relay's mark under this key, so two directories that share a path
// on two machines must not share it, and a destination on the source's own machine keeps the key it
// always had.
describe("relayDestKey", () => {
  it("keeps the bare path when both ends are on one machine", () => {
    expect(relayDestKey({ cwd: "/a" }, { cwd: "/b" })).toBe("/b");
    expect(relayDestKey({ cwd: "/a", host: null }, { cwd: "/b", host: undefined })).toBe("/b");
    expect(relayDestKey({ cwd: "/a", host: "lx" }, { cwd: "/b", host: "lx" })).toBe("/b");
  });

  it("names the destination's machine when it is not the source's", () => {
    expect(relayDestKey({ cwd: "/a" }, { cwd: "/srv/p", host: "lx" })).toBe("lx\0/srv/p");
    expect(relayDestKey({ cwd: "/a", host: "lx" }, { cwd: "/Users/me/p" })).toBe("\0/Users/me/p");
    expect(relayDestKey({ cwd: "/a", host: "lx" }, { cwd: "/srv/p", host: "gpu" })).toBe("gpu\0/srv/p");
  });

  it("keeps the same path on different machines apart", () => {
    const keys = [
      relayDestKey({ cwd: "/s", host: "lx" }, { cwd: "/p", host: "lx" }),
      relayDestKey({ cwd: "/s", host: "lx" }, { cwd: "/p" }),
      relayDestKey({ cwd: "/s", host: "lx" }, { cwd: "/p", host: "gpu" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no key for a destination with no directory", () => {
    expect(relayDestKey({ cwd: "/a" }, { cwd: null })).toBeNull();
    expect(relayDestKey({ cwd: "/a" }, { cwd: "", host: "lx" })).toBeNull();
  });
});
