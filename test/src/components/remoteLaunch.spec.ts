import { describe, it, expect } from "vitest";
import { canStartOn, remoteDirOf } from "../../../src/components/remoteLaunch";
import { cellForAgent, cellForRemoteStart } from "../../../src/components/launchCell";
import { LAUNCH_AGENTS } from "../../../common/launchAgent";
import type { RemoteHostSummary } from "../../../common/remoteHosts";

const host = (state: RemoteHostSummary["state"]): RemoteHostSummary => ({ id: "lx", label: "Linux", state, version: "1.0.0" });

describe("canStartOn", () => {
  it("offers only a host that answered with a compatible version", () => {
    expect(canStartOn(host("reachable"))).toBe(true);
    expect(canStartOn(host("unreachable"))).toBe(false);
    expect(canStartOn(host("version-mismatch"))).toBe(false);
  });
});

describe("remoteDirOf", () => {
  it("keeps an absolute path, trimmed", () => {
    expect(remoteDirOf("/srv/p")).toBe("/srv/p");
    expect(remoteDirOf("  /srv/p \n")).toBe("/srv/p");
    expect(remoteDirOf("/")).toBe("/");
  });
  it("refuses what the remote would resolve to something else", () => {
    ["", "   ", "~", "~/p", "srv/p", "./p", "C:\\p"].forEach((typed) => expect(remoteDirOf(typed)).toBeNull());
  });
});

describe("cellForRemoteStart", () => {
  it("is the local cell for that agent, with the host on it", () => {
    LAUNCH_AGENTS.forEach((agent) => {
      expect(cellForRemoteStart({ host: "lx", dir: " /srv/p ", agent })).toEqual({ ...cellForAgent("/srv/p", agent), remoteHost: "lx" });
    });
  });
  it("places nothing for a directory the remote cannot use", () => {
    expect(cellForRemoteStart({ host: "lx", dir: "~/p", agent: "claude" })).toBeNull();
    expect(cellForRemoteStart({ host: "lx", dir: "", agent: "shell" })).toBeNull();
  });
});
