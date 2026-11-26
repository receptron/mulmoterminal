// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideForward, REMOTE_PATH_MAX, staysInside } from "../../../../server/backends/hostGateway/remoteForward.js";
import { REMOTE_ROUTES, type RemoteRoute } from "../../../../common/remoteRoutes.js";
import { DROP_FILENAME_HEADER } from "../../../../common/dropUpload.js";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
// A table of its own, so the rules are pinned whatever the shipped table holds.
const ROUTES: Record<string, RemoteRoute> = {
  status: { method: "GET", path: "/api/git-status", key: "cwd", access: "read", query: ["cwd", "fresh"] },
  read: { method: "GET", path: "/api/files/browse/text", key: "cwd", access: "read", query: ["cwd", "path"], within: ["path"] },
  memo: { method: "POST", path: "/api/session/:sid/memo", key: "session", access: "write", query: [] },
};
const decide = (method: string, path: string, query: unknown = {}) => decideForward(method, path, query, ROUTES);
const namesSession = (query: readonly string[]): boolean => query.includes("session");

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
  it("ships the search and the whole index, alone, as routes the browser waits longer for", () => {
    const slow = Object.values(REMOTE_ROUTES).filter((route) => "wait" in route && route.wait === "slow");
    expect(slow.map((route) => route.path).sort()).toEqual(["/api/files/browse/index", "/api/files/browse/search"]);
  });
  it("ships a table whose every route decides to forward itself", () => {
    Object.values(REMOTE_ROUTES).forEach((route) => {
      const query = { ...(route.key === "cwd" ? { cwd: "/srv/p" } : {}), ...(namesSession(route.query) ? { session: SESSION } : {}) };
      expect(decideForward(route.method, route.path.replace(":sid", SESSION), query)).toMatchObject({ kind: "forward", route });
    });
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
