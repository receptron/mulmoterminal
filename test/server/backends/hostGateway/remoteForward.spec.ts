// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideForward, REMOTE_PATH_MAX, staysInside } from "../../../../server/backends/hostGateway/remoteForward.js";
import { REMOTE_BYTE_ROUTES, REMOTE_ROUTES, type RemoteRoute } from "../../../../common/remoteRoutes.js";
import { DROP_FILENAME_HEADER } from "../../../../common/dropUpload.js";
import { AGENT_SESSION_LIST_PATHS } from "../../../../common/agentSessionList.js";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
// A table of its own, so the rules are pinned whatever the shipped table holds.
const ROUTES: Record<string, RemoteRoute> = {
  status: { method: "GET", path: "/api/git-status", key: "cwd", access: "read", query: ["cwd", "fresh"] },
  read: { method: "GET", path: "/api/files/browse/text", key: "cwd", access: "read", query: ["cwd", "path"], within: ["path"] },
  memo: { method: "POST", path: "/api/session/:sid/memo", key: "session", access: "write", query: [] },
};
const decide = (method: string, path: string, query: unknown = {}) => decideForward(method, path, query, ROUTES);
const namesSession = (query: readonly string[]): boolean => query.includes("session") || query.includes("sessionId");

describe("decideForward: which requests cross", () => {
  it("forwards a table route with its method", () => {
    expect(decide("GET", "/api/git-status", { cwd: "/srv/p" })).toEqual({ kind: "forward", route: ROUTES.status, path: "/api/git-status?cwd=%2Fsrv%2Fp" });
    expect(decide("post", `/api/session/${SESSION}/memo`)).toMatchObject({ kind: "forward", path: `/api/session/${SESSION}/memo` });
  });
  it.each([
    ["POST", "/api/git-status"],
    ["GET", `/api/session/${SESSION}/memo`],
    ["GET", "/api/git-status/"],
    ["GET", "/api/git-statusx"],
    ["GET", "/api/config"],
    ["POST", "/api/shutdown"],
    ["GET", "/api"],
    ["GET", ""],
  ])("refuses %s %s with 404", (method, path) => {
    expect(decide(method, path, { cwd: "/srv/p" })).toMatchObject({ kind: "refuse", status: 404 });
  });
  it.each(["not-a-session", SESSION.toUpperCase().slice(1), `${SESSION}x`, "..", "%2e%2e", ""])("refuses the session segment %s", (sid) => {
    expect(decide("POST", `/api/session/${sid}/memo`)).toMatchObject({ kind: "refuse", status: 404 });
  });
  it("forwards only the parameters the route names", () => {
    expect(decide("GET", "/api/git-status", { cwd: "/srv/p", fresh: "1", path: "/etc", extra: "x" })).toMatchObject({
      path: "/api/git-status?cwd=%2Fsrv%2Fp&fresh=1",
    });
  });
  it("refuses a parameter given more than once, or not as text", () => {
    [["/a", "/b"], { x: 1 }].forEach((cwd) => expect(decide("GET", "/api/git-status", { cwd })).toMatchObject({ kind: "refuse", status: 400 }));
    expect(decide("GET", "/api/git-status", { cwd: "/srv/p", fresh: ["1", "1"] })).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("reads a missing or malformed query as no parameters", () => {
    [undefined, null, "cwd=/srv", 3].forEach((query) => expect(decide("GET", "/api/git-status", query)).toMatchObject({ kind: "refuse", status: 400 }));
  });
  // The drop route takes bytes; forwarded as JSON, a dropped file would arrive empty or re-encoded.
  it("ships the drop route as a raw body carrying only its type and file name", () => {
    expect(REMOTE_ROUTES.drop).toMatchObject({ method: "POST", key: "session", access: "write", body: "raw", headers: ["content-type", DROP_FILENAME_HEADER] });
    expect(
      Object.values(REMOTE_ROUTES)
        .filter((route) => "body" in route)
        .map((route) => route.path),
    ).toEqual(["/api/session/:sid/drop"]);
  });
  // The remote cannot tell which cell asked, so the gateway is what keeps a Files pane in its directory.
  it("ships the Files pane's routes held to the directory the request names", () => {
    const takesPath = (query: readonly string[]): boolean => query.includes("path");
    const browsing = Object.values(REMOTE_ROUTES).filter((route) => route.path.startsWith("/api/files/browse/") && takesPath(route.query));
    expect(browsing.length).toBeGreaterThan(0);
    browsing.forEach((route) => {
      ["../x", "/etc/passwd", "/srv/pp/x"].forEach((path) =>
        expect(decideForward(route.method, route.path, { cwd: "/srv/p", path })).toMatchObject({ kind: "refuse", status: 400 }),
      );
      expect(decideForward(route.method, route.path, { cwd: "/srv/p", path: "src/a.ts" })).toMatchObject({ kind: "forward" });
    });
  });
  it("ships the search, the whole index and a new worktree, alone, as routes the browser waits longer for", () => {
    const slow = Object.values(REMOTE_ROUTES).filter((route) => "wait" in route && route.wait === "slow");
    expect(slow.map((route) => route.path).sort()).toEqual(["/api/files/browse/index", "/api/files/browse/search", "/api/worktrees/create"]);
  });
  it("ships a table whose every route decides to forward itself", () => {
    Object.values(REMOTE_ROUTES).forEach((route) => {
      const query = { ...(route.key === "cwd" ? { cwd: "/srv/p" } : {}), ...(namesSession(route.query) ? { session: SESSION, sessionId: SESSION } : {}) };
      const body = "bodyKinds" in route ? { kind: route.bodyKinds[0] } : undefined;
      expect(decideForward(route.method, route.path.replace(":sid", SESSION), query, REMOTE_ROUTES, body)).toMatchObject({ kind: "forward", route });
    });
  });
});

// An AskUserQuestion dialog (#3506): read and answered by the path's session.
describe("decideForward: a question", () => {
  it("forwards the open dialog and an answer for a session id, and nothing else under it", () => {
    expect(decideForward("GET", `/api/question/${SESSION}`, { x: 1 })).toMatchObject({ kind: "forward", path: `/api/question/${SESSION}` });
    expect(decideForward("POST", `/api/question/${SESSION}/answer`, {})).toMatchObject({ kind: "forward", path: `/api/question/${SESSION}/answer` });
    expect(decideForward("GET", "/api/question/nope", {})).toMatchObject({ kind: "refuse", status: 404 });
    expect(decideForward("POST", `/api/question/${SESSION}`, {})).toMatchObject({ kind: "refuse", status: 404 });
    expect(decideForward("GET", `/api/question/${SESSION}/answer`, {})).toMatchObject({ kind: "refuse", status: 404 });
  });
});

// The Tools pane (#3506): the tool calls by the path's session, the tools by `?sessionId=`.
describe("decideForward: the Tools pane", () => {
  it("forwards a session's tool calls and tools", () => {
    expect(decideForward("GET", `/api/tool-calls/${SESSION}`, { cwd: "/x" })).toMatchObject({ kind: "forward", path: `/api/tool-calls/${SESSION}` });
    expect(decideForward("GET", "/api/tools", { sessionId: SESSION, cwd: "/x" })).toMatchObject({ kind: "forward", path: `/api/tools?sessionId=${SESSION}` });
  });
  it.each([{}, { sessionId: "" }, { sessionId: "nope" }, { sessionId: [SESSION, SESSION] }, { session: SESSION }])("refuses the tools of %j", (query) => {
    expect(decideForward("GET", "/api/tools", query)).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("refuses a tool-call history whose path names no session", () => {
    expect(decideForward("GET", "/api/tool-calls/not-a-session", {})).toMatchObject({ kind: "refuse", status: 404 });
  });
});

// A session's own record (#3506), named by `?session=` rather than by the path.
describe("decideForward: a session named in the query", () => {
  const decideShipped = (method: string, path: string, query: unknown) => decideForward(method, path, query);
  const routes = ["/api/transcript/prompts", "/api/transcript/view", "/api/transcript/timeline", "/api/transcript/last-turn", "/api/transcript/relay"];
  it.each(routes)("forwards %s for a session id, with the cwd its log lives under", (path) => {
    expect(decideShipped("GET", path, { session: SESSION, cwd: "/srv/p", extra: "x" })).toMatchObject({
      kind: "forward",
      path: `${path}?session=${SESSION}&cwd=%2Fsrv%2Fp`,
    });
    expect(decideShipped("GET", path, { session: SESSION })).toMatchObject({ kind: "forward", path: `${path}?session=${SESSION}` });
  });
  it.each([{}, { session: "" }, { session: "not-an-id" }, { session: `${SESSION}/../x` }, { session: [SESSION, SESSION] }])(
    "refuses the session %j without a request",
    (query) => {
      routes.forEach((path) => expect(decideShipped("GET", path, query)).toMatchObject({ kind: "refuse", status: 400 }));
    },
  );
  it.each(["relative/dir", "/srv/p/..", "/srv//p", "/srv/p/", "/srv/p\0"])("refuses the cwd %j beside it", (cwd) => {
    routes.forEach((path) => expect(decideShipped("GET", path, { session: SESSION, cwd })).toMatchObject({ kind: "refuse", status: 400 }));
  });
  it("carries only the parameters each route reads", () => {
    expect(decideShipped("GET", "/api/transcript/prompts", { session: SESSION, agent: "codex", before: "x" })).toMatchObject({
      path: `/api/transcript/prompts?session=${SESSION}&agent=codex`,
    });
    expect(decideShipped("GET", "/api/transcript/view", { session: SESSION, before: "c1", agent: "codex" })).toMatchObject({
      path: `/api/transcript/view?session=${SESSION}&before=c1`,
    });
    expect(decideShipped("GET", "/api/transcript/last-turn", { session: SESSION, as: "reply", agent: "claude" })).toMatchObject({
      path: `/api/transcript/last-turn?session=${SESSION}&agent=claude&as=reply`,
    });
  });
  // A relay's destination is a key the remote keeps its mark under, never a path it reads.
  it("forwards the relay and its mark with the destination key, and no other write", () => {
    const query = { session: SESSION, agent: "claude", dest: "\0/Users/me/app", cwd: "/srv/p", mark: "x" };
    const path = `?session=${SESSION}&cwd=%2Fsrv%2Fp&agent=claude&dest=%00%2FUsers%2Fme%2Fapp`;
    expect(decideShipped("GET", "/api/transcript/relay", query)).toMatchObject({ kind: "forward", path: `/api/transcript/relay${path}` });
    expect(decideShipped("POST", "/api/transcript/relay-mark", query)).toMatchObject({ kind: "forward", path: `/api/transcript/relay-mark${path}` });
    expect(decideShipped("POST", "/api/transcript/relay-mark", { dest: "/x" })).toMatchObject({ kind: "refuse", status: 400 });
    expect(decideShipped("POST", "/api/transcript/view", { session: SESSION })).toMatchObject({ kind: "refuse", status: 404 });
    expect(decideShipped("GET", "/api/transcript/relay-mark", { session: SESSION })).toMatchObject({ kind: "refuse", status: 404 });
  });
});

// The worktree and GitHub writes (#3506) name their directory in the body; the gateway holds each such
// path to the query's `cwd`, absolute and inside it, without a request.
describe("decideForward: a path named in the body", () => {
  const decideWith = (path: string, body: unknown, query: Record<string, unknown> = { cwd: "/srv/p" }) => decideForward("POST", path, query, undefined, body);
  it.each(["/api/worktrees/push", "/api/worktrees/pr", "/api/work-comment"])("forwards %s for the cell's own directory", (path) => {
    expect(decideWith(path, { cwd: "/srv/p", issue: 3, kind: "pr", pr: 4 })).toMatchObject({ kind: "forward", path: `${path}?cwd=%2Fsrv%2Fp` });
    expect(decideWith(path, { cwd: "/srv/p/sub" })).toMatchObject({ kind: "forward" });
  });
  it.each([
    ["another directory", "/srv/other"],
    ["a sibling sharing the prefix", "/srv/px"],
    ["a climb out", "/srv/p/../other"],
    ["a relative path", "sub"],
    ["a home path the remote expands", "~/p"],
    ["a non-string", 3],
    ["an array", ["/srv/p"]],
    ["a NUL", "/srv/p\0"],
  ])("refuses %s in the body", (_name, cwd) => {
    ["/api/worktrees/push", "/api/worktrees/pr", "/api/work-comment"].forEach((path) =>
      expect(decideWith(path, { cwd })).toMatchObject({ kind: "refuse", status: 400 }),
    );
  });
  it("holds both of a removal's paths to the cell's directory", () => {
    const path = "/api/worktrees/remove";
    expect(decideWith(path, { repoDir: "/srv/p", path: "/srv/p", deleteBranch: true, force: true })).toMatchObject({ kind: "forward" });
    expect(decideWith(path, { repoDir: "/srv/p", path: "/srv/other" })).toMatchObject({ kind: "refuse", status: 400 });
    expect(decideWith(path, { repoDir: "/", path: "/srv/p" })).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("requires the query's cwd that the body is held to", () => {
    expect(decideWith("/api/worktrees/push", { cwd: "/srv/p" }, {})).toMatchObject({ kind: "refuse", status: 400 });
    expect(decideWith("/api/worktrees/push", { cwd: "/srv/p" }, { cwd: "/srv/other" })).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("leaves an absent field to the remote, which refuses it", () => {
    expect(decideWith("/api/worktrees/push", {})).toMatchObject({ kind: "forward" });
    expect(decideWith("/api/worktrees/push", undefined)).toMatchObject({ kind: "forward" });
  });
  it("reads the diff for the cell's directory, and forwards no cleanup", () => {
    expect(decideForward("GET", "/api/worktrees/diff", { cwd: "/srv/p", extra: 1 })).toMatchObject({
      kind: "forward",
      path: "/api/worktrees/diff?cwd=%2Fsrv%2Fp",
    });
    expect(decideForward("GET", "/api/worktrees/cleanup", { cwd: "/srv/p" })).toMatchObject({ kind: "refuse", status: 404 });
    expect(decideWith("/api/worktrees/cleanup/remove", { repoDir: "/srv/p" })).toMatchObject({ kind: "refuse", status: 404 });
  });
});

// The launch form's worktree section (#3506): a repo's worktrees read, and a new one made, for the
// typed directory and nowhere else.
describe("decideForward: the launch form's worktrees", () => {
  const create = (body: unknown, query: Record<string, unknown> = { cwd: "/srv/p" }) => decideForward("POST", "/api/worktrees/create", query, undefined, body);
  it("lists a directory's worktrees, with nothing but it", () => {
    expect(decideForward("GET", "/api/worktrees", { cwd: "/srv/p", fresh: "1" })).toMatchObject({ kind: "forward", path: "/api/worktrees?cwd=%2Fsrv%2Fp" });
    expect(decideForward("GET", "/api/worktrees", { cwd: "/srv/p/.." })).toMatchObject({ kind: "refuse", status: 400 });
    expect(decideForward("GET", "/api/worktrees", {})).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("creates one in the typed repo, its task and issue passed on", () => {
    expect(create({ repoDir: "/srv/p", task: "fix-login", issue: 7 })).toMatchObject({ kind: "forward", path: "/api/worktrees/create?cwd=%2Fsrv%2Fp" });
    expect(create({ repoDir: "/srv/p/sub", task: "t" })).toMatchObject({ kind: "forward" });
  });
  it.each([
    ["another directory", "/srv/other"],
    ["a climb out", "/srv/p/../other"],
    ["a relative path", "sub"],
    ["a home path the remote expands", "~/p"],
    ["a non-string", 3],
  ])("refuses %s as the repo", (_name, repoDir) => {
    expect(create({ repoDir, task: "t" })).toMatchObject({ kind: "refuse", status: 400 });
  });
  it("requires the query's cwd that the repo is held to", () => {
    expect(create({ repoDir: "/srv/p", task: "t" }, {})).toMatchObject({ kind: "refuse", status: 400 });
    expect(create({ repoDir: "/srv/p", task: "t" }, { cwd: "/srv/other" })).toMatchObject({ kind: "refuse", status: 400 });
  });
});

describe("decideForward: the launch form's conversation lists", () => {
  it.each(Object.values(AGENT_SESSION_LIST_PATHS))("reads %s for a directory, with nothing but it", (path) => {
    expect(decideForward("GET", path, { cwd: "/srv/p", account: "work", x: "1" })).toMatchObject({ kind: "forward", path: `${path}?cwd=%2Fsrv%2Fp` });
    expect(decideForward("GET", path, { cwd: "/srv/p/.." })).toMatchObject({ kind: "refuse", status: 400 });
    expect(decideForward("GET", path, {})).toMatchObject({ kind: "refuse", status: 400 });
  });
  it.each(["/api/sessions/live", "/api/sessions/unplaced"])("forwards no other session listing (%s)", (path) => {
    expect(decideForward("GET", path, { cwd: "/srv/p" })).toMatchObject({ kind: "refuse", status: 404 });
  });
});

describe("decideForward: the cell's directory", () => {
  it.each(["", "relative/dir", "/srv/p/", "/srv//p", "/srv/p/..", "/srv/../etc", "/srv/./p", "/srv/p\0", `/${"a".repeat(REMOTE_PATH_MAX)}`])(
    "refuses the cwd %j",
    (cwd) => {
      expect(decide("GET", "/api/git-status", { cwd })).toMatchObject({ kind: "refuse", status: 400 });
    },
  );
  it("requires a cwd on a cwd-keyed route", () => {
    expect(decide("GET", "/api/git-status", {})).toMatchObject({ kind: "refuse", status: 400 });
  });
  it.each(["/", "/srv/p", "/home/me/my project"])("accepts the cwd %j", (cwd) => {
    expect(decide("GET", "/api/git-status", { cwd })).toMatchObject({ kind: "forward" });
  });
  it.each(["/etc/passwd", "../x", "a/../../x", "/srv/pp/x", "/srv", "/srv/p/../q/x", "a\0b"])("refuses a path %j that leaves it", (path) => {
    expect(decide("GET", "/api/files/browse/text", { cwd: "/srv/p", path })).toMatchObject({ kind: "refuse", status: 400 });
  });
  it.each(["/srv/p", "/srv/p/a.md", "a.md", "sub/../a.md", "./a.md", "sub/dir/x"])("accepts a path %j inside it", (path) => {
    expect(decide("GET", "/api/files/browse/text", { cwd: "/srv/p", path })).toMatchObject({ kind: "forward" });
  });
});

describe("staysInside", () => {
  it("treats the filesystem root as containing everything absolute", () => {
    expect(staysInside("/", "/etc")).toBe(true);
    expect(staysInside("/", "../etc")).toBe(true);
  });
  it("does not take a sibling sharing the prefix as inside", () => {
    expect(staysInside("/srv/p", "/srv/p2")).toBe(false);
    expect(staysInside("/srv/p", "../p2")).toBe(false);
  });
  it("refuses an overlong value", () => {
    expect(staysInside("/srv/p", "a".repeat(REMOTE_PATH_MAX + 1))).toBe(false);
  });
});

// A Canvas card's own reads (#3506): one path per plugin serves reads and writes, so only the kinds
// that read cross, and a body naming no kind — the agent's own present call — does not.
describe("decideForward: a Canvas card's reads", () => {
  it.each([
    ["/api/plugin/presentDocument", "loadDoc"],
    ["/api/plugin/presentDocument", "marpThemes"],
    ["/api/plugin/presentDocument", "bookmarkPattern"],
    ["/api/plugin/presentHtml", "loadHtml"],
    ["/api/plugin/presentShapeScript", "loadShape"],
    ["/api/plugin/presentSpreadsheet", "loadSpreadsheet"],
  ])("forwards %s for %s", (path, kind) => {
    expect(decideForward("POST", path, { cwd: "/srv/p", x: "1" }, REMOTE_ROUTES, { kind, path: "/srv/p/a" })).toMatchObject({ kind: "forward", path });
  });

  it.each([
    ["a save", "/api/plugin/presentDocument", { kind: "saveDoc", path: "a.md", markdown: "x" }],
    ["a PDF export", "/api/plugin/presentDocument", { kind: "exportPdf", markdown: "x", filename: "a.pdf" }],
    ["an image fill", "/api/plugin/presentDocument", { kind: "fillImages", markdown: "x" }],
    ["a page save", "/api/plugin/presentHtml", { kind: "saveHtml", path: "a.html", html: "x" }],
    ["a model save", "/api/plugin/presentShapeScript", { kind: "saveShape", path: "a.shape", script: "x" }],
    ["a workbook save", "/api/plugin/presentSpreadsheet", { kind: "saveSpreadsheet", path: "a.xlsx", sheets: [] }],
    ["the other plugin's read", "/api/plugin/presentHtml", { kind: "loadDoc", path: "a.md" }],
    ["a workbook read on the model's route", "/api/plugin/presentShapeScript", { kind: "loadSpreadsheet", path: "a.xlsx" }],
    ["the agent's own call", "/api/plugin/presentDocument", { markdown: "# hi", title: "t" }],
    ["a kind that is not text", "/api/plugin/presentDocument", { kind: ["loadDoc"] }],
    ["no body", "/api/plugin/presentDocument", undefined],
  ])("refuses %s", (_name, path, body) => {
    expect(decideForward("POST", path, {}, REMOTE_ROUTES, body)).toMatchObject({ kind: "refuse", status: 400 });
  });

  it.each(["/api/plugin/presentMulmoScript", "/api/plugin/manageCollection", "/api/plugin/renderShapeScript"])("forwards nothing of %s", (path) => {
    expect(decideForward("POST", path, {}, REMOTE_ROUTES, { kind: "loadDoc" })).toMatchObject({ kind: "refuse", status: 404 });
  });

  it("forwards no GET of the read routes", () => {
    expect(decideForward("GET", "/api/plugin/presentDocument", {})).toMatchObject({ kind: "refuse", status: 404 });
  });
});

// An HTML card's page (#3506): the rest of the path is the page, held to clean segments, and only
// the page's own version marks cross.
describe("decideForward: an HTML card's page, as bytes", () => {
  it.each([
    ["/artifacts/html/2026/a%20b.html", { v: "3", r: "1", cwd: "/x" }, "/artifacts/html/2026/a%20b.html?v=3&r=1"],
    ["/htmlfile/ws/docs/page.html", {}, "/htmlfile/ws/docs/page.html"],
    ["/htmlfile/abs/srv/p/index.htm", { v: "2" }, "/htmlfile/abs/srv/p/index.htm?v=2"],
  ])("forwards %s", (pathname, query, path) => {
    expect(decideForward("GET", pathname, query, REMOTE_BYTE_ROUTES)).toMatchObject({ kind: "forward", path });
  });

  it.each([
    ["the mount itself", "/artifacts/html"],
    ["an empty rest", "/artifacts/html/"],
    ["an empty segment", "/htmlfile/ws//a.html"],
    ["a parent segment", "/artifacts/html/../secret.html"],
    ["a current segment", "/htmlfile/abs/./a.html"],
    ["a NUL", "/htmlfile/abs/a\0.html"],
    ["a path past the cap", `/htmlfile/abs/${"a".repeat(REMOTE_PATH_MAX)}.html`],
    ["another mount", "/artifacts/images/a.png"],
  ])("refuses %s", (_name, pathname) => {
    expect(decideForward("GET", pathname, {}, REMOTE_BYTE_ROUTES)).toMatchObject({ kind: "refuse", status: 404 });
  });

  it("is not a JSON route", () => {
    expect(decideForward("GET", "/artifacts/html/a.html", {})).toMatchObject({ kind: "refuse", status: 404 });
  });
});
