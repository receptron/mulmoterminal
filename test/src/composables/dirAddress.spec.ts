import { describe, it, expect } from "vitest";
import { dirAddressOf, dirApiUrl, dirKeyOf, isRemoteDirKey } from "../../../src/composables/dirAddress";

// Paths a directory can have, including the characters encodeURIComponent and URLSearchParams
// disagree on, so a local URL is proved to be the string it always was.
const ALPHABET = ["a", "Z", "0", "/", " ", "-", "_", ".", "~", "(", ")", "!", "*", "'", "%", "&", "=", "?", "#", "+", "é", "日", ":", "@", "$", ","];
const generatedPaths = (count: number): string[] =>
  Array.from({ length: count }, (_, n) => {
    const chars = Array.from({ length: 1 + (n % 24) }, (_unused, i) => ALPHABET[(n * 7 + i * 13) % ALPHABET.length] ?? "a");
    return `/${chars.join("")}`;
  });
const GENERATED = 500;

describe("dirKeyOf / dirAddressOf", () => {
  it("keys a local directory by its bare path", () => {
    expect(dirKeyOf(null, "/srv/p")).toBe("/srv/p");
    expect(dirKeyOf(undefined, "/srv/p")).toBe("/srv/p");
    expect(dirKeyOf("", "/srv/p")).toBe("/srv/p");
  });
  it("has no key without a directory", () => {
    [null, undefined, ""].forEach((cwd) => {
      expect(dirKeyOf(null, cwd)).toBeNull();
      expect(dirKeyOf("lx", cwd)).toBeNull();
    });
  });
  it("round-trips host and path, and keeps the two machines' same path apart", () => {
    generatedPaths(GENERATED).forEach((cwd) => {
      const remote = dirKeyOf("lx", cwd) ?? "";
      expect(dirAddressOf(remote)).toEqual({ host: "lx", cwd });
      expect(dirAddressOf(dirKeyOf(null, cwd) ?? "")).toEqual({ host: null, cwd });
      expect(remote).not.toBe(cwd);
      expect(isRemoteDirKey(remote)).toBe(true);
      expect(isRemoteDirKey(cwd)).toBe(false);
    });
  });
});

describe("dirApiUrl", () => {
  it("asks the same URLs as before for a local directory", () => {
    generatedPaths(GENERATED).forEach((dir) => {
      expect(dirApiUrl(dir, "/api/git-status")).toBe(`/api/git-status?cwd=${encodeURIComponent(dir)}`);
      expect(dirApiUrl(dir, "/api/git-status", { fresh: "1" })).toBe(`/api/git-status?cwd=${encodeURIComponent(dir)}&fresh=1`);
      expect(dirApiUrl(dir, "/api/pr-phase")).toBe(`/api/pr-phase?cwd=${encodeURIComponent(dir)}`);
      expect(dirApiUrl(dir, "/api/dir-config")).toBe(`/api/dir-config?cwd=${encodeURIComponent(dir)}`);
    });
  });
  it("asks the gateway for a remote directory, with the remote's path", () => {
    expect(dirApiUrl(dirKeyOf("lx", "/srv/my p") ?? "", "/api/git-status", { fresh: "1" })).toBe("/remote/lx/api/git-status?cwd=%2Fsrv%2Fmy%20p&fresh=1");
  });
});
