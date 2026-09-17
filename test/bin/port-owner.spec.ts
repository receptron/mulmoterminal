// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createServer } from "node:http";

import { portOwnerCommand, parsePortOwners, portOwners, type PortOwnerRunner } from "../../bin/port-owner.js";

// A stand-in for the lookup command, typed by the module's own runner contract — so these cases
// need no cast, and a change to that contract fails here rather than silently passing.
const runner =
  (fail: Parameters<Parameters<PortOwnerRunner>[3]>[0], stdout = "", stderr = ""): PortOwnerRunner =>
  (_file, _args, _options, cb) =>
    cb(fail, stdout, stderr);

describe("portOwnerCommand", () => {
  it("narrows to LISTENING sockets on POSIX", () => {
    // Without it, a browser tab CONNECTED to the port is reported as an owner too, and `stop`
    // would then refuse the real server because the pid set contains a stranger.
    const { file, args } = portOwnerCommand(34567, "darwin");
    expect(file).toBe("lsof");
    expect(args).toContain("-sTCP:LISTEN");
    expect(args).toContain("tcp:34567");
  });

  it("skips the lookups that make lsof slow", () => {
    // -n (no reverse DNS) and -P (no service names): measured at 115ms with, 850ms without.
    expect(portOwnerCommand(34567, "linux").args).toContain("-nP");
  });

  it("asks PowerShell for OwningProcess on Windows, narrowed the same way", () => {
    const { file, args } = portOwnerCommand(34567, "win32");
    expect(file).toBe("powershell.exe");
    expect(args.join(" ")).toContain("Get-NetTCPConnection -LocalPort 34567 -State Listen");
    expect(args.join(" ")).toContain("OwningProcess");
    // No profile, or a user's PowerShell profile runs on every stop.
    expect(args).toContain("-NoProfile");
  });
});

describe("parsePortOwners", () => {
  it("reads one pid per line", () => {
    expect(parsePortOwners("1234\n5678\n")).toEqual([1234, 5678]);
  });

  it("tolerates the padding PowerShell adds and CRLF", () => {
    expect(parsePortOwners("  1234  \r\n  5678  \r\n")).toEqual([1234, 5678]);
  });

  it("yields nothing for empty or non-numeric output", () => {
    expect(parsePortOwners("")).toEqual([]);
    expect(parsePortOwners("\n\n")).toEqual([]);
    expect(parsePortOwners("Get-NetTCPConnection : not recognized")).toEqual([]);
  });
});

describe("portOwners", () => {
  // null and [] are DIFFERENT answers: [] is "the OS says nobody", null is "could not ask".
  // Collapsing them turns "cannot check" into "not ours", which would refuse to stop a real server.
  it("returns null when the tool is not installed", async () => {
    const run = runner(Object.assign(new Error("spawn lsof ENOENT"), { code: "ENOENT" }));
    expect(await portOwners(34567, { run, platform: "linux" })).toBeNull();
  });

  it("returns null when the lookup had to be killed", async () => {
    const run = runner(Object.assign(new Error("timed out"), { killed: true }));
    expect(await portOwners(34567, { run, platform: "darwin" })).toBeNull();
  });

  // [] is not only reported: the launcher DELETES a registry entry over it (#2090). Every way a
  // lookup can fail to answer must therefore stay null, or a live server's entry is erased.
  it("returns null when the tool exists but cannot be STARTED — a policy-blocked powershell.exe", async () => {
    const run = runner(Object.assign(new Error("spawn powershell.exe EACCES"), { code: "EACCES" }));
    expect(await portOwners(34567, { run, platform: "win32" })).toBeNull();
  });

  it("returns null when the lookup ran and failed, saying why on stderr", async () => {
    const run = runner(Object.assign(new Error("exit 1"), { code: 1 }), "", "Get-NetTCPConnection : The term is not recognized");
    expect(await portOwners(34567, { run, platform: "win32" })).toBeNull();
  });

  it("returns [] — an answer — when the tool exits non-zero with no match", async () => {
    // lsof exits 1 when nothing matches. That is "nobody is listening", not a failure.
    const run = runner(Object.assign(new Error("exit 1"), { code: 1 }));
    expect(await portOwners(34567, { run, platform: "darwin" })).toEqual([]);
  });

  it("answers [] for a real port nobody holds — the answer a registry entry is deleted over", async () => {
    // Against the real OS for the same reason as the case below, and on Windows especially: it is
    // the only evidence that PowerShell's "no match" comes back as an answer rather than a failure.
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    await new Promise<void>((r) => server.close(() => r()));
    const owners = await portOwners(addr.port);
    if (owners === null && process.platform !== "win32") return; // no lsof here — covered above
    expect(owners).toEqual([]);
  });

  it("names the real owner of a real socket", async () => {
    // Against the actual OS, because the whole point of this module is that the kernel answers.
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    try {
      const owners = await portOwners(addr.port);
      // Skipped rather than failed where the tool is absent — that case is covered above, and a
      // runner without lsof must not turn into a red build over an environment fact. NOT on
      // Windows: PowerShell is always there, so null means the lookup timed out or failed, which
      // is exactly what would leave a stale registry entry standing on a user's machine (#2090).
      if (owners === null && process.platform !== "win32") return;
      expect(owners).toContain(process.pid);
    } finally {
      server.close();
    }
  });
});
