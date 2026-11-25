import { describe, it, expect } from "vitest";
import { isRemoteHostId, parseRemoteHostDirs, parseRemoteHostsResponse, REMOTE_DIR_PRESETS_MAX, remotePath, remotePathOf } from "../../common/remoteHosts";

describe("isRemoteHostId", () => {
  it("accepts lowercase slugs", () => {
    ["a", "linux1", "build-box", "0", "a".repeat(32)].forEach((id) => expect(isRemoteHostId(id)).toBe(true));
  });
  it("refuses anything that would need escaping in a path, or is not a string", () => {
    ["", "-a", "A", "linux_1", "a/b", "a.b", "a b", "a%2f", "a".repeat(33), "..", null, undefined, 1, {}].forEach((id) =>
      expect(isRemoteHostId(id)).toBe(false),
    );
  });
});

describe("remotePathOf", () => {
  it("splits a remote path into the host and the rest", () => {
    expect(remotePathOf("/remote/linux1/ws")).toEqual({ id: "linux1", rest: "/ws" });
    expect(remotePathOf("/remote/linux1/ws/codex")).toEqual({ id: "linux1", rest: "/ws/codex" });
    expect(remotePathOf("/remote/linux1/")).toEqual({ id: "linux1", rest: "/" });
    expect(remotePathOf("/remote/a/api/x/y")).toEqual({ id: "a", rest: "/api/x/y" });
  });
  it("answers null for every other path", () => {
    [
      "/",
      "/ws",
      "/ws/pubsub",
      "/remote",
      "/remote/",
      "/remote/linux1",
      "/remotex/linux1/ws",
      "/Remote/linux1/ws",
      "/remote//ws",
      "/remote/Bad/ws",
      "/remote/a_b/ws",
      "/api/remote/linux1/ws",
      "",
    ].forEach((path) => expect(remotePathOf(path)).toBeNull());
  });
  it("is the inverse of remotePath for every valid id and absolute path", () => {
    ["a", "linux1", "x-y"].forEach((id) =>
      ["/", "/ws", "/ws/run", "/api/sessions"].forEach((path) => expect(remotePathOf(remotePath(id, path))).toEqual({ id, rest: path })),
    );
  });
});

describe("parseRemoteHostsResponse", () => {
  it("keeps well-formed rows", () => {
    const body = { hosts: [{ id: "a", label: "A", state: "reachable", version: "7.0.0" }], rejected: [{ index: 1, reason: "x" }] };
    expect(parseRemoteHostsResponse(body)).toEqual(body);
  });
  it("drops malformed rows and survives a malformed body", () => {
    const body = {
      hosts: [
        { id: "A", label: "A", state: "reachable", version: null },
        { id: "a", label: "A", state: "up", version: null },
        { id: "b", label: "B", state: "unreachable", version: null },
      ],
      rejected: [{ index: "1", reason: "x" }],
    };
    expect(parseRemoteHostsResponse(body)).toEqual({ hosts: [{ id: "b", label: "B", state: "unreachable", version: null }], rejected: [] });
    [null, undefined, "x", [], { hosts: "x" }].forEach((bad) => expect(parseRemoteHostsResponse(bad)).toEqual({ hosts: [], rejected: [] }));
  });
});

describe("parseRemoteHostDirs", () => {
  it("keeps an absolute workspace and the saved directories with absolute paths, copying only label and path", () => {
    expect(
      parseRemoteHostDirs("/home/u/ws", [
        { label: "app", path: "/home/u/app", color: "#f00" },
        { label: "rel", path: "app" },
        { label: "tilde", path: "~/app" },
        { label: 3, path: "/x" },
        null,
        "/y",
      ]),
    ).toEqual({ cwd: "/home/u/ws", presets: [{ label: "app", path: "/home/u/app" }] });
  });
  it("answers nothing for a config that is missing or malformed", () => {
    [undefined, null, "", "ws", 3, {}].forEach((cwd) => expect(parseRemoteHostDirs(cwd, cwd)).toEqual({ cwd: null, presets: [] }));
  });
  it("caps how many directories it keeps", () => {
    const many = Array.from({ length: REMOTE_DIR_PRESETS_MAX + 5 }, (_, i) => ({ label: `d${i}`, path: `/d${i}` }));
    expect(parseRemoteHostDirs(null, many).presets).toHaveLength(REMOTE_DIR_PRESETS_MAX);
  });
});
