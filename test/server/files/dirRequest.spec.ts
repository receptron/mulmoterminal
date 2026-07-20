import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveDirRequest } from "../../../server/files/dirRequest.js";

// A minimal Response that records the status + json it was sent, enough to assert
// which guard branch fired.
function fakeRes() {
  const sent: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, sent };
}

function reqFor(body: unknown, origin?: string): Request {
  return { headers: { origin }, body } as unknown as Request;
}

const allowAll = () => true;

describe("resolveDirRequest", () => {
  it("returns the directory for an allowed origin + absolute existing dir", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-dirreq-"));
    try {
      const { res, sent } = fakeRes();
      expect(resolveDirRequest(reqFor({ path: dir }), res, allowAll)).toBe(dir);
      expect(sent.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a forbidden origin with 403 and does not read the body", () => {
    const { res, sent } = fakeRes();
    expect(resolveDirRequest(reqFor({ path: "/tmp" }), res, () => false)).toBeNull();
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: "forbidden origin" });
  });

  it("rejects a missing path with 400", () => {
    const { res, sent } = fakeRes();
    expect(resolveDirRequest(reqFor({}), res, allowAll)).toBeNull();
    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({ error: "absolute path required" });
  });

  it("rejects a relative path with 400", () => {
    const { res, sent } = fakeRes();
    expect(resolveDirRequest(reqFor({ path: "relative/dir" }), res, allowAll)).toBeNull();
    expect(sent.status).toBe(400);
  });

  it("rejects a non-object body with 400", () => {
    const { res, sent } = fakeRes();
    expect(resolveDirRequest(reqFor("not-an-object"), res, allowAll)).toBeNull();
    expect(sent.status).toBe(400);
  });

  it("rejects an absolute path that is a file, not a directory, with 400", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-dirreq-"));
    const file = path.join(dir, "a.txt");
    writeFileSync(file, "x");
    try {
      const { res, sent } = fakeRes();
      expect(resolveDirRequest(reqFor({ path: file }), res, allowAll)).toBeNull();
      expect(sent.status).toBe(400);
      expect(sent.body).toEqual({ error: "not a directory" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-existent absolute path with 404", () => {
    const { res, sent } = fakeRes();
    expect(resolveDirRequest(reqFor({ path: path.join(tmpdir(), "mt-does-not-exist-xyz") }), res, allowAll)).toBeNull();
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ error: "directory not found" });
  });
});
