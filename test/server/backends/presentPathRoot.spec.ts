// @vitest-environment node
// presentDocument / presentHtml's relative `path` is resolved against the calling
// SESSION's directory, not the workspace. Two layers are asserted here: the pure
// rewrite (which values move and which are left for core to judge) and the route
// middleware that applies it, including the no-header case that every non-session
// caller — the scheduler, feeds, a direct POST — still takes.
import { describe, it, expect } from "vitest";
import express from "express";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { absolutizePresentPath, mountPresentPathRoot, SESSION_HEADER } from "../../../server/backends/presentPathRoot.js";

const MD = [".md"] as const;
const HTML = [".html", ".htm"] as const;
const SHAPE = [".shape"] as const;
// A session cwd is a native absolute path, so the fixtures are resolved rather than spelled
// POSIX-only: on Windows `/repos/…` is drive-relative and the separator is `\`.
const CWD = path.resolve("/repos/mulmoterminal");
const WORKSPACE = path.resolve("/home/u/mulmoclaude");

describe("absolutizePresentPath", () => {
  it("resolves a relative path against the session cwd", () => {
    expect(absolutizePresentPath({ title: "T", path: "README.md" }, CWD, MD)).toEqual({ title: "T", path: path.join(CWD, "README.md") });
    expect(absolutizePresentPath({ path: "docs/design.md" }, CWD, MD)).toEqual({ path: path.join(CWD, "docs", "design.md") });
    expect(absolutizePresentPath({ path: "docs/report.html" }, CWD, HTML)).toEqual({ path: path.join(CWD, "docs", "report.html") });
    expect(absolutizePresentPath({ path: "models/lamp.shape" }, CWD, SHAPE)).toEqual({ path: path.join(CWD, "models", "lamp.shape") });
  });

  it("leaves an absolute path alone", () => {
    const args = { path: "/elsewhere/notes.md" };
    expect(absolutizePresentPath(args, CWD, MD)).toBe(args);
  });

  it("leaves `artifacts/…` on the workspace, so a just-saved document still opens", () => {
    const doc = { path: "artifacts/documents/2026/08/notes-1.md" };
    expect(absolutizePresentPath(doc, CWD, MD)).toBe(doc);
    const page = { path: "artifacts/html/2026/08/page.html" };
    expect(absolutizePresentPath(page, CWD, HTML)).toBe(page);
  });

  it("leaves a View dispatch (`kind`) alone — the browser names no session", () => {
    const args = { kind: "saveDoc", path: "README.md", markdown: "x" };
    expect(absolutizePresentPath(args, CWD, MD)).toBe(args);
  });

  it("leaves a value core's own gate would refuse, rather than laundering it", () => {
    for (const bad of ["../secrets.md", "./README.md", "docs//design.md", "notes.txt", "a\0b.md", ""]) {
      const args = { path: bad };
      expect(absolutizePresentPath(args, CWD, MD)).toBe(args);
    }
    // Wrong tool's extension: an .html value under the markdown list is not rewritten.
    const html = { path: "docs/report.html" };
    expect(absolutizePresentPath(html, CWD, MD)).toBe(html);
  });

  it("passes through a body with no usable `path`", () => {
    for (const args of [undefined, null, "nope", [], { markdown: "# hi" }, { path: 42 }]) {
      expect(absolutizePresentPath(args, CWD, MD)).toBe(args);
    }
  });
});

describe("the /api/plugin middleware", () => {
  const SESSION = "11111111-2222-3333-4444-555555555555";

  const DOT_SESSION = "99999999-8888-7777-6666-555555555555";
  const DOT_CWD = path.resolve("/home/u/.mulmoterminal/worktrees/repo-ab12/task");

  const app = express();
  app.use(express.json());
  const cwds = new Map([
    [SESSION, CWD],
    [DOT_SESSION, DOT_CWD],
  ]);
  mountPresentPathRoot(app, { workspace: WORKSPACE, cwdForSession: (id) => cwds.get(id ?? "") ?? WORKSPACE });
  // Stand-in for the real dispatch route: echo whatever body the middleware left.
  app.post("/api/plugin/:toolName", (req, res) => res.json(req.body));
  const request = appRequest(app);

  const post = (tool: string, body: unknown, sessionId?: string) =>
    request(`/api/plugin/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sessionId ? { [SESSION_HEADER]: sessionId } : {}) },
      body: JSON.stringify(body),
    });

  const call = async (tool: string, body: unknown, sessionId?: string) => {
    return (await (await post(tool, body, sessionId)).json()) as { path?: string };
  };

  it("resolves against the calling session's directory", async () => {
    expect((await call("presentDocument", { path: "README.md" }, SESSION)).path).toBe(path.resolve(CWD, "README.md"));
    expect((await call("presentHtml", { path: "docs/report.html" }, SESSION)).path).toBe(path.resolve(CWD, "docs/report.html"));
    // Without this mapping a model named relatively resolves from the global workspace,
    // so an agent in one project silently opens another project's same-named file.
    expect((await call("presentShapeScript", { path: "models/lamp.shape" }, SESSION)).path).toBe(path.resolve(CWD, "models/lamp.shape"));
    // The pair has to agree: presenting and RENDERING the same relative path must
    // name the same file, or an agent checks one model and shows another.
    expect((await call("renderShapeScript", { path: "models/lamp.shape" }, SESSION)).path).toBe(path.resolve(CWD, "models/lamp.shape"));
  });

  // Byte-identical, NOT "resolved to the same file": an absolute document path breaks the
  // View's relative image refs, which resolve workspace-relative through /api/files/raw.
  it("leaves a workspace-rooted session's path exactly as it was", async () => {
    expect((await call("presentDocument", { path: "notes/a.md" })).path).toBe("notes/a.md");
    expect((await call("presentDocument", { path: "notes/a.md" }, "not-a-session")).path).toBe("notes/a.md");
  });

  it("refuses an HTML page under a dot-prefixed session directory, with the reason", async () => {
    const res = await post("presentHtml", { path: "report.html" }, DOT_SESSION);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain(path.resolve(DOT_CWD, "report.html"));
    expect(error).toContain("dot-prefixed segment");
  });

  // Markdown does not go through the /htmlfile mount, so the same directory is fine.
  it("still presents a markdown document from a dot-prefixed session directory", async () => {
    expect((await call("presentDocument", { path: "notes.md" }, DOT_SESSION)).path).toBe(path.resolve(DOT_CWD, "notes.md"));
  });

  it("does not touch another tool's `path`", async () => {
    expect((await call("presentChart", { path: "README.md" }, SESSION)).path).toBe("README.md");
    // Nor a tool name that would read a member off Object.prototype through index access.
    expect((await call("constructor", { path: "README.md" }, SESSION)).path).toBe("README.md");
  });
});
