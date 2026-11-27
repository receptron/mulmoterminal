import { describe, it, expect } from "vitest";
import {
  parseRemoteAskQuestion,
  remoteSessionAddressOf,
  parseRemoteSessionChannel,
  remoteSessionChannel,
  isRemoteHostId,
  parseRemoteSessionsMessage,
  remoteActivityOf,
  remoteSessionKey,
  remoteSessionRowOf,
  remoteSessionDetailOf,
  parseRemoteHostDirs,
  parseRemoteHostIds,
  parseRemoteHostsResponse,
  REMOTE_DIR_PRESETS_MAX,
  remotePath,
  remotePathOf,
} from "../../common/remoteHosts";

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

describe("parseRemoteHostIds", () => {
  it("keeps the valid ids and drops everything else", () => {
    expect(parseRemoteHostIds({ ids: ["lx", "Bad", 3, null, "b-2"] })).toEqual(["lx", "b-2"]);
    [undefined, null, [], { ids: "lx" }, "lx"].forEach((body) => expect(parseRemoteHostIds(body)).toEqual([]));
  });
});

describe("remote session messages", () => {
  const ROW = { id: "s1", working: true, waiting: false, event: "Stop", cwd: "/srv", lastPrompt: null };
  it("reads a row or a resync, and nothing else", () => {
    expect(parseRemoteSessionsMessage({ host: "lx", row: ROW })).toEqual({ host: "lx", row: ROW });
    expect(parseRemoteSessionsMessage({ host: "lx", resync: true })).toEqual({ host: "lx", resync: true });
    [null, {}, { host: "LX", resync: true }, { host: "lx" }, { host: "lx", row: { id: "" } }, { host: "lx", resync: "yes" }].forEach((data) =>
      expect(parseRemoteSessionsMessage(data)).toBeNull(),
    );
  });
  it("copies only the known fields, and only with the right types", () => {
    expect(remoteSessionRowOf({ ...ROW, memo: 3, extra: "x", failed: "no" }, () => true)).toEqual(ROW);
    expect(remoteSessionRowOf(ROW, () => false)).toBeNull();
  });
  it("keys a remote session by host and id, so equal ids on two hosts stay apart", () => {
    expect(remoteSessionKey("lx", "s1")).not.toBe(remoteSessionKey("ly", "s1"));
    expect(remoteSessionKey("lx", "s1")).not.toBe("s1");
  });
  it("cuts an activity answer to the asked ids and three fields", () => {
    expect(remoteActivityOf({ a: { working: true, waiting: true, event: "x", memo: "m" }, b: "junk" }, ["a", "b", "c"])).toEqual({
      a: { working: true, waiting: true, event: "x" },
      b: { working: false, waiting: false, event: null },
      c: { working: false, waiting: false, event: null },
    });
    expect(remoteActivityOf(null, ["a"])).toEqual({ a: { working: false, waiting: false, event: null } });
  });
});

describe("remoteSessionDetailOf", () => {
  it("keeps the fields a remote cell shows, each only with the type it reads", () => {
    const usage = { inputTokens: 1 };
    const context = { model: "m", contextTokens: 2 };
    expect(
      remoteSessionDetailOf({
        working: true,
        waiting: "no",
        event: "Stop",
        lastPrompt: "p",
        lastResponse: null,
        aiTitle: 3,
        customTitle: "c",
        memo: null,
        workPhase: "editing",
        usage,
        context: "big",
        peerName: "peer",
        collection: { slug: "x" },
        cwd: "/srv",
        id: "x",
      }),
    ).toEqual({ working: true, event: "Stop", lastPrompt: "p", lastResponse: null, customTitle: "c", memo: null, workPhase: "editing", usage });
    expect(remoteSessionDetailOf({ context })).toEqual({ context });
  });
  it("answers nothing for a body that is not a record", () => {
    [null, undefined, "x", 3, []].forEach((body) => expect(remoteSessionDetailOf(body)).toEqual({}));
  });
});

// #3506. The Mac-side name of a remote session's channel: a browser listening to it makes the relay
// follow the remote's own channel, so only known kinds with a real id and host may name one.
describe("remote session channels", () => {
  const ID = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
  const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
  it("round-trips a known kind of a session on a host", () => {
    expect(remoteSessionChannel("lx", "toolcalls", ID)).toBe(`remote:lx:toolcalls:${ID}`);
    expect(parseRemoteSessionChannel(remoteSessionChannel("lx", "toolcalls", ID), isId)).toEqual({ host: "lx", channel: `toolcalls:${ID}` });
    expect(parseRemoteSessionChannel(remoteSessionChannel("lx", "session", ID), isId)).toEqual({ host: "lx", channel: `session:${ID}` });
  });
  it.each([
    `toolcalls:${ID}`,
    `remote:lx:ask-question:${ID}`,
    `remote:lx:plugin:x:file:${ID}`,
    `remote:lx:toolcalls:not-an-id`,
    `remote:lx:toolcalls:${ID}:extra`,
    `remote:LX:toolcalls:${ID}`,
    `remote::toolcalls:${ID}`,
    "remote:lx:toolcalls",
    "remote-sessions",
    "",
  ])("names nothing for %j", (room) => {
    expect(parseRemoteSessionChannel(room, isId)).toBeNull();
  });
});

describe("remoteSessionAddressOf", () => {
  it("splits a remote session key, and names nothing for a bare id", () => {
    expect(remoteSessionAddressOf("lx/abc")).toEqual({ host: "lx", id: "abc" });
    ["abc", "", "/abc", "lx/", "LX/abc", "l x/abc"].forEach((key) => expect(remoteSessionAddressOf(key)).toBeNull());
  });
});

describe("parseRemoteAskQuestion", () => {
  it("reads a relayed dialog with its host, and nothing else", () => {
    const dialog = { sessionId: "s1", toolUseId: "t1", questions: [{ question: "Pick?", header: "Pick", options: [{ label: "A" }], multiSelect: false }] };
    const done = { sessionId: "s1", toolUseId: "t1", done: true };
    expect(parseRemoteAskQuestion({ host: "lx", question: dialog })).toEqual({ host: "lx", question: dialog });
    expect(parseRemoteAskQuestion({ host: "lx", question: done })).toEqual({ host: "lx", question: done });
    [null, {}, { host: "lx" }, { host: "lx", question: { a: 1 } }, { host: "LX", question: dialog }, { question: dialog }].forEach((data) =>
      expect(parseRemoteAskQuestion(data)).toBeNull(),
    );
  });
});
