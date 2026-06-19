import { describe, it, expect } from "vitest";
import { buildCustomViewSrcdoc } from "./customViewSrcdoc";

const boot = { slug: "watchlist", token: "tok", dataUrl: "/api/collections/watchlist/view-data", origin: "http://localhost:5173" };

describe("buildCustomViewSrcdoc", () => {
  it("injects __MC_VIEW with an absolutised dataUrl", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    expect(out).toContain("window.__MC_VIEW=");
    expect(out).toContain('"dataUrl":"http://localhost:5173/api/collections/watchlist/view-data"');
    expect(out).toContain('"token":"tok"');
    expect(out).toContain('"slug":"watchlist"');
  });

  it("locks connect-src to the server origin only", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    const csp = /content="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(csp).toContain("connect-src http://localhost:5173");
    expect(csp).toContain("default-src 'none'");
    // connect-src must not be widened to https: (that's the exfil channel that matters).
    expect(csp).not.toMatch(/connect-src[^;]*https:/);
  });

  it("allows https: images/media (matches MulmoClaude's documented tradeoff)", () => {
    const csp = /content="([^"]*)"/.exec(buildCustomViewSrcdoc("<head></head>", boot))?.[1] ?? "";
    expect(csp).toMatch(/img-src[^;]*https:/);
    expect(csp).toMatch(/media-src[^;]*https:/);
  });

  it("injects into an existing <head>", () => {
    const out = buildCustomViewSrcdoc('<head data-x="1"><title>t</title></head>', boot);
    expect(out).toMatch(/<head data-x="1"><meta http-equiv="Content-Security-Policy"/);
  });

  it("wraps a fragment with no <head>", () => {
    const out = buildCustomViewSrcdoc("<div>hi</div>", boot);
    expect(out.startsWith("<!DOCTYPE html><html><head>")).toBe(true);
    expect(out).toContain("<body><div>hi</div></body>");
  });

  it("escapes < in the injected JSON so a hostile value can't break out of <script>", () => {
    const out = buildCustomViewSrcdoc("<head></head>", { ...boot, token: "</script><script>alert(1)" });
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
  });
});
