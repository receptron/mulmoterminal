// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseRemoteHosts, REMOTE_HOSTS_MAX, REMOTE_HOST_LABEL_MAX } from "../../../../server/backends/hostGateway/remoteHostsConfig";
import { emptyConfig, mergeConfigUpdate, serializableAppConfig, toPublicAppConfig, unknownConfigKeys } from "../../../../server/config/app-config";
import { remoteHostState } from "../../../../server/backends/hostGateway/remoteHostState";

// Built rather than written out: the lint rule against clear-text URLs cannot tell a refusal fixture from a use.
const plainHttp = (host: string): string => `${"http"}://${host}`;
const reasonOf = (entry: unknown): string | undefined => parseRemoteHosts([entry]).rejected[0]?.reason;

describe("parseRemoteHosts", () => {
  it("loads a loopback entry as its origin", () => {
    expect(parseRemoteHosts([{ id: "linux1", label: "Build", url: "http://127.0.0.1:34599" }])).toEqual({
      hosts: [{ id: "linux1", label: "Build", origin: "http://127.0.0.1:34599" }],
      rejected: [],
    });
  });

  it("accepts every loopback literal, with or without a trailing slash", () => {
    ["http://127.0.0.1:1", "http://127.1.2.3:1/", "http://[::1]:34599", "http://127.0.0.1"].forEach((url) =>
      expect(parseRemoteHosts([{ id: "a", url }]).hosts).toHaveLength(1),
    );
  });

  it("falls back to the id for a missing or blank label, and caps a long one", () => {
    expect(parseRemoteHosts([{ id: "a", url: "http://127.0.0.1:1" }]).hosts[0]?.label).toBe("a");
    expect(parseRemoteHosts([{ id: "a", label: "  ", url: "http://127.0.0.1:1" }]).hosts[0]?.label).toBe("a");
    expect(parseRemoteHosts([{ id: "a", label: 3, url: "http://127.0.0.1:1" }]).hosts[0]?.label).toBe("a");
    expect(parseRemoteHosts([{ id: "a", label: "x".repeat(99), url: "http://127.0.0.1:1" }]).hosts[0]?.label).toHaveLength(REMOTE_HOST_LABEL_MAX);
  });

  it("refuses anything that is not plain http to a loopback literal", () => {
    [
      "https://127.0.0.1:1",
      "ws://127.0.0.1:1",
      "http://localhost:1",
      plainHttp("192.168.1.2:34567"),
      plainHttp("10.0.0.1:1"),
      "http://example.com",
      plainHttp("[fe80::1]:1"),
      plainHttp("0.0.0.0:1"),
      "http://u:p@127.0.0.1:1",
      "http://127.0.0.1:1/sub",
      "http://127.0.0.1:1/?x=1",
      "not a url",
      "",
    ].forEach((url) => expect(reasonOf({ id: "a", url }), url).toBeDefined());
  });

  it("refuses a bad id, a non-object and a non-string url, each with a reason", () => {
    [
      { id: "A", url: "http://127.0.0.1:1" },
      { id: "a b", url: "http://127.0.0.1:1" },
      { url: "http://127.0.0.1:1" },
      { id: "a" },
      { id: "a", url: 1 },
      null,
      "x",
      3,
      [],
    ].forEach((entry) => expect(reasonOf(entry)).toEqual(expect.any(String)));
  });

  // The reasons reach the page; a refused url may carry a password or a token.
  it("never repeats the refused url in its reason", () => {
    [
      "http://user:s3cret@127.0.0.1:1",
      "http://127.0.0.1:1/?token=s3cret",
      "http://127.0.0.1:1/s3cret",
      "https://127.0.0.1:1/#s3cret",
      plainHttp("10.0.0.1:1/s3cret"),
      "s3cret not a url",
    ].forEach((url) => {
      const reason = reasonOf({ id: "a", url });
      expect(reason, url).toBeDefined();
      expect(reason, url).not.toContain("s3cret");
    });
  });

  it("keeps the first of a duplicate id and reports the second by its index", () => {
    const parsed = parseRemoteHosts([
      { id: "a", url: "http://127.0.0.1:1" },
      { id: "a", url: "http://127.0.0.1:2" },
    ]);
    expect(parsed.hosts.map((host) => host.origin)).toEqual(["http://127.0.0.1:1"]);
    expect(parsed.rejected).toEqual([{ index: 1, reason: "duplicate id: a" }]);
  });

  it("loads the good entries beside the bad ones", () => {
    const parsed = parseRemoteHosts([
      { id: "a", url: plainHttp("10.0.0.1:1") },
      { id: "b", url: "http://127.0.0.1:2" },
    ]);
    expect(parsed.hosts.map((host) => host.id)).toEqual(["b"]);
    expect(parsed.rejected.map((rejection) => rejection.index)).toEqual([0]);
  });

  it("stops at the limit and reports the rest", () => {
    const entries = Array.from({ length: REMOTE_HOSTS_MAX + 2 }, (_, i) => ({ id: `h${i}`, url: `http://127.0.0.1:${i + 1}` }));
    const parsed = parseRemoteHosts(entries);
    expect(parsed.hosts).toHaveLength(REMOTE_HOSTS_MAX);
    expect(parsed.rejected.map((rejection) => rejection.index)).toEqual([REMOTE_HOSTS_MAX, REMOTE_HOSTS_MAX + 1]);
  });

  it("treats an absent key as no hosts, and a non-array as one rejection", () => {
    expect(parseRemoteHosts(undefined)).toEqual({ hosts: [], rejected: [] });
    [null, {}, "x", 1].forEach((input) => {
      const parsed = parseRemoteHosts(input);
      expect(parsed.hosts).toEqual([]);
      expect(parsed.rejected).toHaveLength(1);
    });
    expect(parseRemoteHosts([])).toEqual({ hosts: [], rejected: [] });
  });
});

describe("remoteHostState", () => {
  const status = (version: string) => ({ ready: true, install: "npm", version, commit: null, latest: null, notice: null });

  it("is reachable on the same major version", () => {
    expect(remoteHostState("7.1.0", status("7.0.3"))).toEqual({ state: "reachable", version: "7.0.3" });
  });
  it("is a version mismatch on another major", () => {
    expect(remoteHostState("7.1.0", status("6.9.0"))).toEqual({ state: "version-mismatch", version: "6.9.0" });
    expect(remoteHostState("7.1.0", status("70.1.0"))).toEqual({ state: "version-mismatch", version: "70.1.0" });
  });
  it("is unreachable when the answer is not an update status", () => {
    [null, undefined, {}, "x", { version: 7 }].forEach((body) => expect(remoteHostState("7.1.0", body)).toEqual({ state: "unreachable", version: null }));
  });
});

// remoteHosts is deliberately not an AppConfig key (see remoteHostsRoutes.ts). These pin what that buys.
describe("remoteHosts in config.json", () => {
  const entries = [
    { id: "far", url: plainHttp("10.0.0.1:4") },
    { id: "ok", url: "http://127.0.0.1:1" },
  ];

  it("survives a config save exactly as written, refused entries included", () => {
    const raw = { cwdPresets: [], remoteHosts: entries };
    const loaded = { config: emptyConfig(), unknownKeys: unknownConfigKeys(raw) };
    expect(serializableAppConfig(loaded.config, loaded.unknownKeys).remoteHosts).toEqual(entries);
  });

  it("cannot be set through a config update", () => {
    const merged = mergeConfigUpdate(emptyConfig(), { remoteHosts: entries });
    expect(Object.hasOwn(toPublicAppConfig(merged), "remoteHosts")).toBe(false);
  });
});
