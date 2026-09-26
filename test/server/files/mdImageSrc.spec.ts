// @vitest-environment node
import { describe, it, expect } from "vitest";
import { servedImageSrc } from "../../../server/files/mdImageSrc";

// #2261. A rendered document lives at `/api/files/browse/md?…`, so a relative image resolved
// against that URL and 404'd. It is pointed at the raw route, beside the document.
const raw = (base: string, rel: string): string => `/api/files/raw?cwd=${encodeURIComponent(base)}&path=${encodeURIComponent(rel)}`;
const DOC = { base: "/Users/me/proj", dirRel: "docs/guide/en" };

describe("servedImageSrc", () => {
  it.each([
    ["a sibling directory", "../images/x.png", "docs/guide/images/x.png"],
    ["a file beside the document", "x.png", "docs/guide/en/x.png"],
    ["an explicitly relative file", "./shots/x.png", "docs/guide/en/shots/x.png"],
    ["a climb that stays inside", "../../../top.png", "top.png"],
    ["a percent-encoded name", "my%20pic.png", "docs/guide/en/my pic.png"],
    ["a query or fragment", "x.png?raw=1#frag", "docs/guide/en/x.png"],
    ["a backslash separator", "..\\images\\x.png", "docs/guide/images/x.png"],
  ])("points %s at the raw route, beside the document", (_case, src, resolved) => {
    expect(servedImageSrc(src, DOC)).toBe(raw(DOC.base, resolved));
  });

  it("resolves against the base itself when the document is at the top", () => {
    expect(servedImageSrc("images/x.png", { base: "/b", dirRel: "" })).toBe(raw("/b", "images/x.png"));
  });

  it("leaves a path that names the base itself as written", () => {
    expect(servedImageSrc(".", { base: "/b", dirRel: "" })).toBeNull();
  });

  it.each([
    ["a climb above the base", "../../../../secret.png"],
    ["an https URL", "https://example.com/x.png"],
    ["a protocol-relative URL", "//example.com/x.png"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a root-relative path", "/images/x.png"],
    ["a fragment", "#top"],
    ["a query alone", "?x=1"],
    ["an empty src", ""],
    ["malformed escapes", "bad%zz.png"],
  ])("leaves %s as written", (_case, src) => {
    expect(servedImageSrc(src, DOC)).toBeNull();
  });
});
