// #3506. What a remote cell's Canvas hands a card's view: the HTML page through the byte proxy, an
// inline chart as it is, and nothing for a chart that reads a range it would read from this machine.
import { describe, it, expect } from "vitest";
import { drawnAsIs, htmlPageOnHost, inlineChartsOnly, mulmoScriptMediaPath, type CanvasCardResult } from "../../../src/components/remoteCanvasCards";

const card = (data: unknown): CanvasCardResult => ({ uuid: "u1", toolName: "t", data });
const previewOf = (result: CanvasCardResult | null): unknown =>
  result !== null && typeof result.data === "object" && result.data !== null && "previewUrl" in result.data ? result.data.previewUrl : undefined;

describe("drawnAsIs", () => {
  it("hands the view the result it came with", () => {
    const result = card({ a: 1 });
    expect(drawnAsIs(result, "lx")).toBe(result);
  });
});

describe("htmlPageOnHost", () => {
  it.each([
    ["a page under artifacts/html", "artifacts/html/2026/a b.html", "/remote/lx/bytes/artifacts/html/2026/a%20b.html"],
    ["a page in the workspace", "docs/page.html", "/remote/lx/bytes/htmlfile/ws/docs/page.html"],
    ["a page anywhere on disk", "/srv/p/site/index.htm", "/remote/lx/bytes/htmlfile/abs/srv/p/site/index.htm"],
  ])("points the iframe at the host for %s", (_name, filePath, url) => {
    const result = htmlPageOnHost(card({ title: "T", filePath }), "lx");
    expect(previewOf(result)).toBe(url);
    expect(result?.data).toMatchObject({ title: "T", filePath });
  });

  it("keeps a URL the result already names, on the host", () => {
    expect(previewOf(htmlPageOnHost(card({ filePath: "x.html", previewUrl: "/artifacts/html/y.html" }), "lx"))).toBe("/remote/lx/bytes/artifacts/html/y.html");
  });

  it.each([
    ["no data", undefined],
    ["data that is not a record", "x"],
    ["no path", { title: "T" }],
    ["a path that is not a page", { filePath: "notes.md" }],
    ["a URL that is not a path on this server", { filePath: "x.html", previewUrl: "https://example.com/x.html" }],
  ])("leaves the result as it was for %s", (_name, data) => {
    const result = card(data);
    expect(htmlPageOnHost(result, "lx")).toBe(result);
  });

  it("leaves the result it was given untouched", () => {
    const data = { filePath: "artifacts/html/a.html" };
    htmlPageOnHost(card(data), "lx");
    expect(data).toEqual({ filePath: "artifacts/html/a.html" });
  });
});

describe("inlineChartsOnly", () => {
  const chart = (extra: Record<string, unknown> = {}) => ({ option: { series: [] }, ...extra });
  const SOURCE = { spreadsheet: "artifacts/spreadsheets/a.xlsx", range: "A1:B3" };

  it("draws a document whose every chart is written inline", () => {
    const result = card({ document: { charts: [chart(), chart({ title: "b" })] } });
    expect(inlineChartsOnly(result, "lx")).toBe(result);
  });

  it.each([
    ["one chart reading a range", { document: { charts: [chart(), chart({ source: SOURCE })] } }],
    ["one chart reading several", { document: { charts: [chart({ sources: [SOURCE] })] } }],
    ["no document", {}],
    ["a document with no charts list", { document: { title: "x" } }],
    ["no data", undefined],
  ])("does not draw %s", (_name, data) => {
    expect(inlineChartsOnly(card(data), "lx")).toBeNull();
  });
});

describe("mulmoScriptMediaPath", () => {
  it.each([
    [null, { moviePath: "stories/out/a b.mp4" }, "/api/mulmoscript/media?moviePath=stories%2Fout%2Fa+b.mp4"],
    [null, { pdfPath: "stories/out/a.pdf" }, "/api/mulmoscript/media?pdfPath=stories%2Fout%2Fa.pdf"],
    [null, {}, "/api/mulmoscript/media?moviePath="],
    ["lx", { moviePath: "/srv/p/out/a.mp4" }, "/remote/lx/bytes/api/mulmoscript/media?moviePath=%2Fsrv%2Fp%2Fout%2Fa.mp4"],
    ["lx", { moviePath: "m.mp4", pdfPath: "p.pdf" }, "/remote/lx/bytes/api/mulmoscript/media?pdfPath=p.pdf"],
  ])("on %s, fetches %o from %s", (host, query, path) => {
    expect(mulmoScriptMediaPath(host, query)).toBe(path);
  });
});
