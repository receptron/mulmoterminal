import { describe, it, expect } from "vitest";
import { mayConnect, remoteHostStatus, type ConfiguredHosts } from "../../../src/components/remoteHostStatus";

const LOADING: ConfiguredHosts = { state: "loading" };
const FAILED: ConfiguredHosts = { state: "failed" };
const known = (...ids: string[]): ConfiguredHosts => ({ state: "known", ids });

describe("remoteHostStatus", () => {
  it("is local for a cell with no host, whatever the list says", () => {
    [null, undefined, ""].forEach((host) => [LOADING, FAILED, known(), known("lx")].forEach((list) => expect(remoteHostStatus(host, list)).toBe("local")));
  });
  it("waits while the list is loading, and trusts the host when the list could not be read", () => {
    expect(remoteHostStatus("lx", LOADING)).toBe("pending");
    expect(remoteHostStatus("lx", FAILED)).toBe("present");
  });
  it("is gone only when a known list leaves the host out", () => {
    expect(remoteHostStatus("lx", known("lx", "b"))).toBe("present");
    expect(remoteHostStatus("lx", known("b"))).toBe("gone");
    expect(remoteHostStatus("lx", known())).toBe("gone");
  });
  it("connects only a local cell or one whose host is present", () => {
    expect((["local", "pending", "present", "gone"] as const).filter(mayConnect)).toEqual(["local", "present"]);
  });
});
