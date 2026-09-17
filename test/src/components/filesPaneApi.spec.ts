import { describe, it, expect, vi, afterEach } from "vitest";
import { askTheMachine, bankText, browseQuery, writeBuffer } from "../../../src/components/filesPaneApi";

// These outcomes are the ones that matter most in the Files pane and were the hardest to arrange
// while they lived inside it: a save that LOSES the version race, a backup store that refuses, a
// host with no file manager to call. Each is one call here.

/** A `fetch` that answers every request the same way. */
const answering = (res: { ok?: boolean; status?: number; body?: unknown }): typeof fetch => {
  const status = res.status ?? (res.ok === false ? 500 : 200);
  return vi.fn(async () => ({ ok: res.ok ?? status < 400, status, json: async () => res.body ?? {} })) as unknown as typeof fetch;
};

const refusing = (message: string): typeof fetch =>
  vi.fn(async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("browseQuery", () => {
  it("carries both the root and the path", () => {
    expect(browseQuery("/proj", "src/a.ts")).toBe("cwd=%2Fproj&path=src%2Fa.ts");
  });

  // An absent cwd is how the server is told to use its default workspace; sending `cwd=` instead
  // would be a root the server has to resolve and cannot.
  it("omits the root when the pane has none", () => {
    expect(browseQuery(null, "a.ts")).toBe("path=a.ts");
  });

  it("escapes a path that would otherwise end the query", () => {
    expect(browseQuery(null, "a&b=c.ts")).toBe("path=a%26b%3Dc.ts");
  });

  it("asks about the root itself with an empty path", () => {
    expect(browseQuery("/proj", "")).toBe("cwd=%2Fproj&path=");
  });
});

describe("writeBuffer", () => {
  it("reports the new version on a save", async () => {
    globalThis.fetch = answering({ status: 200, body: { ok: true, version: "v2" } });
    expect(await writeBuffer("path=a.ts", "hi", "v1")).toEqual({ status: "saved", version: "v2" });
  });

  // 409 is the agent in this very directory having written the file first. Nothing was saved, and
  // the version that comes back is what an "Overwrite anyway" re-sends as its base.
  it("reports a conflict with the version now on disk", async () => {
    globalThis.fetch = answering({ status: 409, body: { error: "file changed on disk", version: "v9" } });
    expect(await writeBuffer("path=a.ts", "hi", "v1")).toEqual({ status: "conflict", version: "v9" });
  });

  it("passes the server's own words through on a refusal", async () => {
    globalThis.fetch = answering({ status: 415, body: { error: "this file cannot be edited as text" } });
    expect(await writeBuffer("path=a.xlsx", "hi", null)).toEqual({ status: "error", message: "this file cannot be edited as text" });
  });

  it("falls back to the status when the body says nothing", async () => {
    globalThis.fetch = answering({ status: 500, body: {} });
    expect(await writeBuffer("path=a.ts", "hi", null)).toEqual({ status: "error", message: "HTTP 500" });
  });

  // A server that is not there must not throw past the caller: the buffer still has to be banked.
  it("turns an unreachable server into an error outcome rather than a rejection", async () => {
    globalThis.fetch = refusing("Failed to fetch");
    expect(await writeBuffer("path=a.ts", "hi", null)).toEqual({ status: "error", message: "Failed to fetch" });
  });

  it("reports no version when the body's is not a string", async () => {
    globalThis.fetch = answering({ status: 200, body: { version: 7 } });
    expect(await writeBuffer("path=a.ts", "hi", null)).toEqual({ status: "saved", version: null });
  });
});

describe("bankText", () => {
  it("says the copy landed", async () => {
    globalThis.fetch = answering({ status: 200, body: { stored: true } });
    expect(await bankText("path=a.ts", "hi")).toBe(true);
  });

  // The conflict banner promises "your version is kept either way", so a store that refuses has to
  // be distinguishable — discarding anyway is what loses what was typed.
  it("says it did not when the store refuses", async () => {
    globalThis.fetch = answering({ status: 507, body: {} });
    expect(await bankText("path=a.ts", "hi")).toBe(false);
  });

  it("says it did not when the server is unreachable", async () => {
    globalThis.fetch = refusing("Failed to fetch");
    expect(await bankText("path=a.ts", "hi")).toBe(false);
  });
});

describe("askTheMachine", () => {
  it("says nothing when it worked", async () => {
    globalThis.fetch = answering({ status: 200, body: { ok: true } });
    expect(await askTheMachine("/api/files/reveal", "/proj/a.ts", "could not show /proj/a.ts")).toBeNull();
  });

  it("prefers the server's explanation", async () => {
    globalThis.fetch = answering({ status: 500, body: { error: "no file manager on this host" } });
    expect(await askTheMachine("/api/files/reveal", "/proj/a.ts", "could not show /proj/a.ts")).toBe("no file manager on this host");
  });

  // #1447: a host with no opener looked exactly like a successful one. Silence is the one answer
  // this must never give, so an empty `error` still produces words.
  it("names the subject and the status when the body explains nothing", async () => {
    globalThis.fetch = answering({ status: 500, body: { error: "" } });
    expect(await askTheMachine("/api/files/open", "/proj/a.ts", "could not open a.ts")).toBe("could not open a.ts (HTTP 500)");
  });

  it("names the subject when the request never got out", async () => {
    globalThis.fetch = refusing("Failed to fetch");
    expect(await askTheMachine("/api/files/open", "/proj/a.ts", "could not open a.ts")).toBe("could not open a.ts: Failed to fetch");
  });
});
