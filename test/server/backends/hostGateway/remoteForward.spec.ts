// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decideForward, REMOTE_PATH_MAX, staysInside } from "../../../../server/backends/hostGateway/remoteForward.js";
import { REMOTE_ROUTES, type RemoteRoute } from "../../../../common/remoteRoutes.js";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
// A table of its own, so the rules are pinned whatever the shipped table holds.
const ROUTES: Record<string, RemoteRoute> = {
  status: { method: "GET", path: "/api/git-status", key: "cwd", access: "read", query: ["cwd", "fresh"] },
  read: { method: "GET", path: "/api/files/browse/text", key: "cwd", access: "read", query: ["cwd", "path"], within: ["path"] },
  memo: { method: "POST", path: "/api/session/:sid/memo", key: "session", access: "write", query: [] },
};
const decide = (method: string, path: string, query: unknown = {}) => decideForward(method, path, query, ROUTES);

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
  it("ships a table whose every route decides to forward itself", () => {
    Object.values(REMOTE_ROUTES).forEach((route) => {
      const query = route.key === "cwd" ? { cwd: "/srv/p" } : {};
      expect(decideForward(route.method, route.path.replace(":sid", SESSION), query)).toMatchObject({ kind: "forward", route });
    });
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
