import { describe, it, expect } from "vitest";
import { sessionDetailPath } from "../../../src/components/remoteCell";

// The URL a LOCAL cell asked before the remote case existed, written out as the cell built it.
const localPathAsBuilt = (id: string, agent: string, cwd: string | null) => {
  const params = new URLSearchParams({ agent });
  if (cwd) params.set("cwd", cwd);
  return `/api/session/${id}?${params}`;
};

const IDS = ["0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69"];
const AGENTS = ["claude", "codex", "grok", "a b&c"];
const CWDS = [null, "", "/srv/p", "/with space/&?#", "C:\\x"];
const HOSTS_LOCAL = [null, undefined, ""];

const CASES = IDS.flatMap((id) => AGENTS.flatMap((agent) => CWDS.flatMap((cwd) => HOSTS_LOCAL.map((host) => ({ id, agent, cwd, host })))));

describe("sessionDetailPath", () => {
  it("is exactly the URL a local cell asked before, for every agent and directory", () => {
    CASES.forEach(({ id, agent, cwd, host }) => expect(sessionDetailPath(id, agent, cwd, host)).toBe(localPathAsBuilt(id, agent, cwd)));
  });
  it("asks the gateway for a remote cell, with the same query", () => {
    expect(sessionDetailPath(IDS[0] ?? "", "codex", "/srv/p", "lx")).toBe(`/api/remote-hosts/lx/session/${IDS[0]}?agent=codex&cwd=%2Fsrv%2Fp`);
  });
});
