import { describe, it, expect } from "vitest";
import { rewriteWikiImageSrc } from "./wikiImageSrc";

describe("rewriteWikiImageSrc", () => {
  it("leaves external + inlined refs untouched", () => {
    for (const src of ["https://x.test/a.png", "http://x.test/a.png", "//cdn.test/a.png", "data:image/png;base64,AAA", "blob:abc", "/api/files/raw?path=x"]) {
      expect(rewriteWikiImageSrc(src)).toBe(src);
    }
  });

  it("resolves a page-relative ref against data/wiki/pages", () => {
    expect(rewriteWikiImageSrc("img.png")).toBe("/api/files/raw?path=data%2Fwiki%2Fpages%2Fimg.png");
    expect(rewriteWikiImageSrc("./img.png")).toBe("/api/files/raw?path=data%2Fwiki%2Fpages%2Fimg.png");
  });

  it("climbs out of pages/ with ..", () => {
    expect(rewriteWikiImageSrc("../sources/fig.png")).toBe("/api/files/raw?path=data%2Fwiki%2Fsources%2Ffig.png");
  });

  it("treats a leading slash as workspace-root-relative", () => {
    expect(rewriteWikiImageSrc("/data/assets/logo.png")).toBe("/api/files/raw?path=data%2Fassets%2Flogo.png");
  });

  it("never climbs above the workspace root", () => {
    expect(rewriteWikiImageSrc("../../../../../etc/passwd")).toBe("/api/files/raw?path=etc%2Fpasswd");
  });
});
