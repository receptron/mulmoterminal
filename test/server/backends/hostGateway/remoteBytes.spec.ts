// @vitest-environment node
// #3506. What the byte proxy passes on of a remote's response, and how it keeps a rendered document's
// links on the host. A file from another machine served under this origin is held by the remote's own
// policy, so the policy must be there, and nothing else of the remote's headers crosses.
import { describe, it, expect } from "vitest";
import { bytesPlan, rewriteRenderedDoc, sandboxes } from "../../../../server/backends/hostGateway/remoteBytes";

const headersOf =
  (given: Record<string, string>) =>
  (name: string): string | null =>
    given[name] ?? null;

const NOSNIFF = { "x-content-type-options": "nosniff" };

describe("sandboxes", () => {
  it.each(["sandbox", "SANDBOX", "sandbox allow-scripts; script-src 'nonce-x'", "default-src 'none'; sandbox", " sandbox "])(
    "reads %j as sandboxing",
    (policy) => {
      expect(sandboxes(policy)).toBe(true);
    },
  );
  it.each(["", "default-src 'self'", "sandboxed", "script-src sandbox", "frame-ancestors 'none'"])("reads %j as not sandboxing", (policy) => {
    expect(sandboxes(policy)).toBe(false);
  });
});

describe("bytesPlan", () => {
  it("passes a sandboxed document on with its policy, as one to rewrite", () => {
    const plan = bytesPlan(
      headersOf({ "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts; script-src 'nonce-n'", ...NOSNIFF }),
    );
    expect(plan).toEqual({
      ok: true,
      rendered: true,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "sandbox allow-scripts; script-src 'nonce-n'",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  });

  it("passes a sandboxed picture on as it came, with its range", () => {
    const plan = bytesPlan(
      headersOf({
        "content-type": "image/png",
        "content-security-policy": "sandbox",
        ...NOSNIFF,
        "content-length": "9",
        "content-range": "bytes 0-8/9",
        "accept-ranges": "bytes",
      }),
    );
    expect(plan).toMatchObject({ ok: true, rendered: false, headers: { "content-length": "9", "content-range": "bytes 0-8/9", "accept-ranges": "bytes" } });
  });

  // The remote serves these unsandboxed because a browser will not open them sandboxed.
  it.each(["application/pdf", "video/mp4", "audio/mpeg"])("passes %s on without a sandbox, still nosniff", (type) => {
    expect(bytesPlan(headersOf({ "content-type": type, ...NOSNIFF }))).toMatchObject({ ok: true, rendered: false });
  });

  it.each([
    ["no content type", { ...NOSNIFF, "content-security-policy": "sandbox" }],
    ["no nosniff", { "content-type": "image/png", "content-security-policy": "sandbox" }],
    ["a document without a sandbox", { "content-type": "text/html", ...NOSNIFF }],
    ["a document under a policy that does not sandbox", { "content-type": "text/html", "content-security-policy": "default-src 'self'", ...NOSNIFF }],
    ["an SVG without a sandbox", { "content-type": "image/svg+xml", ...NOSNIFF }],
    ["a PDF without nosniff", { "content-type": "application/pdf" }],
  ])("refuses %s", (_name, given) => {
    expect(bytesPlan(headersOf(given))).toMatchObject({ ok: false });
  });

  it("carries none of the remote's other headers", () => {
    const plan = bytesPlan(
      headersOf({
        "content-type": "image/png",
        "content-security-policy": "sandbox",
        ...NOSNIFF,
        "set-cookie": "a=1",
        "cache-control": "max-age=99",
        etag: "x",
        "access-control-allow-origin": "*",
      }),
    );
    expect(plan.ok && Object.keys(plan.headers).sort()).toEqual(["cache-control", "content-security-policy", "content-type", "x-content-type-options"]);
    expect(plan.ok && plan.headers["cache-control"]).toBe("no-store");
  });
});

describe("rewriteRenderedDoc", () => {
  it("points the document's pictures at the host's bytes", () => {
    const html = `<img src="/api/files/raw?cwd=%2Fsrv&amp;path=a.png"><img src='/api/files/raw?path=b.png'><div style="background:url(/api/files/raw?path=c.png)">`;
    expect(rewriteRenderedDoc(html, "lx")).toBe(
      `<img src="/remote/lx/bytes/api/files/raw?cwd=%2Fsrv&amp;path=a.png"><img src='/remote/lx/bytes/api/files/raw?path=b.png'><div style="background:url(/remote/lx/bytes/api/files/raw?path=c.png)">`,
    );
  });
  it("leaves every other link alone", () => {
    const html = `<a href="/api/files/rawx?a">x</a> text /api/files/raw?path=a <script src="/api/files/mermaid/1/m.mjs"></script> <img src="https://example.com/api/files/raw?x">`;
    expect(rewriteRenderedDoc(html, "lx")).toBe(html);
  });
});
