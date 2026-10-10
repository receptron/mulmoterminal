// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { MERMAID_ASSET_ROUTE, installedMermaid, mermaidAssetFile, mermaidEntryUrl, mountMermaidAssetRoute } from "../../../server/files/mermaidAssets";

// #2991. The Preview imports mermaid from this server. The document is opaque-origin, so the asset
// has to answer a CORS fetch; and the route serves the entry and its chunks, nothing else the
// package ships.

const dist = installedMermaid();
const ENTRY = `/${dist.version}/mermaid.esm.min.mjs`;
const CHUNK_DIR = "chunks/mermaid.esm.min";

describe("installedMermaid", () => {
  it("finds the installed package's browser build and version", () => {
    expect(existsSync(path.join(dist.dir, "mermaid.esm.min.mjs"))).toBe(true);
    expect(existsSync(path.join(dist.dir, CHUNK_DIR))).toBe(true);
    expect(dist.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("mermaidAssetFile", () => {
  it("admits the entry and a chunk, for the installed version", () => {
    expect(mermaidAssetFile(ENTRY, dist.version)).toBe("mermaid.esm.min.mjs");
    expect(mermaidAssetFile(`/${dist.version}/${CHUNK_DIR}/chunk-ABC123.mjs`, dist.version)).toBe(`${CHUNK_DIR}/chunk-ABC123.mjs`);
  });

  it.each([
    ["another version", "/0.0.0/mermaid.esm.min.mjs"],
    ["the UMD build", "/{v}/mermaid.min.js"],
    ["a type declaration", "/{v}/mermaid.d.ts"],
    ["a source map", "/{v}/chunks/mermaid.esm.min/chunk-ABC123.mjs.map"],
    ["a climb out of the chunk directory", "/{v}/chunks/mermaid.esm.min/../../package.json"],
    ["the package file", "/{v}/../package.json"],
    ["a chunk outside the chunk directory", "/{v}/chunk-ABC123.mjs"],
    ["nothing", "/"],
  ])("refuses %s", (_what, requestPath) => {
    expect(mermaidAssetFile(requestPath.replace("{v}", dist.version), dist.version)).toBeNull();
  });

  // A mermaid upgrade that moved or renamed its chunks would otherwise fail in the browser alone,
  // as a diagram that stays a code block: every chunk the entry imports, and every chunk shipped,
  // has to be one the allowlist admits.
  it("admits every chunk the entry imports and every chunk the package ships", () => {
    const entry = readFileSync(path.join(dist.dir, "mermaid.esm.min.mjs"), "utf8");
    const imported = [...entry.matchAll(/from"\.\/([^"]+)"|import"\.\/([^"]+)"/g)].map((match) => match[1] ?? match[2] ?? "");
    expect(imported.length).toBeGreaterThan(0);
    imported.forEach((rel) => expect(mermaidAssetFile(`/${dist.version}/${rel}`, dist.version)).toBe(rel));
    const shipped = readdirSync(path.join(dist.dir, CHUNK_DIR)).filter((name) => name.endsWith(".mjs"));
    expect(shipped.length).toBeGreaterThan(0);
    shipped.forEach((name) => expect(mermaidAssetFile(`/${dist.version}/${CHUNK_DIR}/${name}`, dist.version)).toBe(`${CHUNK_DIR}/${name}`));
  });
});

describe(`GET ${MERMAID_ASSET_ROUTE}`, () => {
  const serve = () => {
    const app = express();
    const entryUrl = mountMermaidAssetRoute(app, dist);
    return { call: routeCall(app), entryUrl };
  };

  it("names the entry it serves", () => {
    expect(serve().entryUrl).toBe(mermaidEntryUrl(dist.version));
    expect(serve().entryUrl).toBe(`${MERMAID_ASSET_ROUTE}${ENTRY}`);
  });

  it("serves the entry as a script any origin may fetch, cached for good", async () => {
    const { call, entryUrl } = serve();
    const res = await call(entryUrl);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.text.startsWith("import")).toBe(true);
  });

  it("serves a chunk the entry imports", async () => {
    const { call } = serve();
    const [first] = readdirSync(path.join(dist.dir, CHUNK_DIR)).filter((name) => name.endsWith(".mjs"));
    const res = await call(`${MERMAID_ASSET_ROUTE}/${dist.version}/${CHUNK_DIR}/${first}`);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it.each([["/0.0.0/mermaid.esm.min.mjs"], ["/{v}/mermaid.d.ts"], ["/{v}/package.json"]])("answers 404 for %s", async (requestPath) => {
    const { call } = serve();
    const res = await call(`${MERMAID_ASSET_ROUTE}${requestPath.replace("{v}", dist.version)}`);
    expect(res.status).toBe(404);
  });

  it("serves nothing to a write", async () => {
    const { call, entryUrl } = serve();
    const res = await call(entryUrl, { method: "POST", body: "" });
    expect(res.status).toBe(404);
  });
});
