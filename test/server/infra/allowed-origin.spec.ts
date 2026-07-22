import { describe, it, expect } from "vitest";

import { isAllowedOrigin } from "../../../server/infra/allowed-origin.js";

// The predicate every route module and the pub/sub socket is handed, and which all of their
// tests stub out — so until now the real one was never run. It is the only thing standing
// between a page the user happens to visit and their local Claude PTY, so the cases that
// matter are the ones where a hostile origin tries to look local.
describe("isAllowedOrigin", () => {
  describe("same-machine origins are allowed", () => {
    it.each(["http://localhost:34567", "http://localhost", "https://localhost:5173", "http://127.0.0.1:34567", "http://127.0.0.1"])("allows %s", (origin) => {
      expect(isAllowedOrigin(origin)).toBe(true);
    });

    // Any port: the Vite dev server proxies from its own.
    it("allows localhost on a port nobody configured", () => {
      expect(isAllowedOrigin("http://localhost:61234")).toBe(true);
    });

    it("allows the bracketed IPv6 loopback", () => {
      expect(isAllowedOrigin("http://[::1]:34567")).toBe(true);
    });

    // `new URL` normalises the long form, so the check never sees the expanded spelling.
    it("allows the expanded IPv6 loopback, which normalises to [::1]", () => {
      expect(isAllowedOrigin("http://[0:0:0:0:0:0:0:1]:34567")).toBe(true);
    });

    it("allows an upper-cased origin, which normalises to lower case", () => {
      expect(isAllowedOrigin("HTTP://LOCALHOST:34567")).toBe(true);
    });

    // The accepted set reaches further than its four literals suggest: `new URL` expands
    // every shorthand and alternate base for an IPv4 address before the check sees it. Each
    // of these IS 127.0.0.1, so allowing them is right — worth pinning so the normalisation
    // is a decision on the record rather than a surprise found later.
    it.each(["http://127.1", "http://127.0.1", "http://2130706433", "http://0x7f.0.0.1"])("allows %s, which normalises to 127.0.0.1", (origin) => {
      expect(isAllowedOrigin(origin)).toBe(true);
      expect(new URL(origin).hostname).toBe("127.0.0.1");
    });
  });

  // A non-browser local client (curl, the CLI, a native app) sends no Origin at all, and it
  // cannot be a cross-site request. Anything a BROWSER sends has one.
  describe("a missing origin is allowed", () => {
    it("allows undefined", () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
    });

    it("allows a call with no argument", () => {
      expect(isAllowedOrigin()).toBe(true);
    });

    it("allows the empty string, which is what an absent header reads as", () => {
      expect(isAllowedOrigin("")).toBe(true);
    });
  });

  // The scheme is never consulted, so these carry the https a real page would be served
  // over — the hostname is the whole decision.
  describe("a remote origin is refused", () => {
    it.each(["https://evil.com", "https://evil.com:34567", "https://claude.ai", "https://192.168.1.10:34567", "https://10.0.0.5"])("refuses %s", (origin) => {
      expect(isAllowedOrigin(origin)).toBe(false);
    });
  });

  // The whole point of parsing rather than string-matching. Each of these contains the text
  // "localhost" or "127.0.0.1" somewhere a substring check would accept.
  describe("hosts that merely look local are refused", () => {
    it("refuses a subdomain of an attacker's domain", () => {
      expect(isAllowedOrigin("https://localhost.evil.com")).toBe(false);
    });

    it("refuses an attacker's domain prefixed with the loopback address", () => {
      expect(isAllowedOrigin("https://127.0.0.1.evil.com")).toBe(false);
    });

    it("refuses a host that merely ends in localhost", () => {
      expect(isAllowedOrigin("https://notlocalhost")).toBe(false);
    });

    // The userinfo trick: everything before @ is credentials, and the real host is evil.com.
    it("refuses an origin where localhost is only the userinfo", () => {
      expect(isAllowedOrigin("https://localhost@evil.com")).toBe(false);
    });

    it("refuses an origin where the loopback address is only the userinfo", () => {
      expect(isAllowedOrigin("https://127.0.0.1@evil.com")).toBe(false);
    });
  });

  describe("anything unparseable is refused", () => {
    // What a file:// page and a sandboxed iframe send. It must not be read as "no origin".
    it("refuses the literal string null", () => {
      expect(isAllowedOrigin("null")).toBe(false);
    });

    it.each(["not a url", "//localhost", "localhost:34567", "http://", " "])("refuses %o", (origin) => {
      expect(isAllowedOrigin(origin)).toBe(false);
    });

    // A scheme with no host at all parses, but its hostname is empty.
    it("refuses a file URL", () => {
      expect(isAllowedOrigin("file:///Users/me/page.html")).toBe(false);
    });
  });

  // Deliberately narrower than 127.0.0.0/8 and than the IPv6-mapped forms: only the one
  // address, however it is spelled. Nothing a browser sends for a page this server served
  // uses the rest, and widening the set should have to be argued for rather than inherited.
  describe("loopback addresses other than 127.0.0.1 are refused", () => {
    it.each(["https://127.0.0.2", "https://127.0.0.53", "https://[::ffff:127.0.0.1]", "https://0.0.0.0"])("refuses %s", (origin) => {
      expect(isAllowedOrigin(origin)).toBe(false);
    });
  });
});
