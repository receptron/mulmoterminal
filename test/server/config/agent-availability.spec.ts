// @vitest-environment node
//
// What GET /api/agents answers (#2082): one row per launchable agent, `installed` decided by the
// same binary resolution the spawn will use.
//
// The bins are PASSED IN rather than set through the environment, and that is not a convenience:
// `AGENT_BINS` captures every `<AGENT>_BIN` at import, so a spec that sets one afterwards is
// talking to nobody — the values are already read. That freezing is the shipped behaviour
// (`<AGENT>_BIN` is a start-up setting), so the decision is what gets tested, with the reading
// supplied.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";
import { agentAvailability, type AgentBins } from "../../../server/config/agent-availability";
import { sanitizePtyEnv } from "../../../server/infra/pty-env";
import { hasBinary, type BinaryProbe } from "../../../server/infra/has-binary";

const binsWhere = (overrides: Partial<AgentBins> = {}): AgentBins => {
  const bins = Object.fromEntries(TERMINAL_AGENTS.map((agent) => [agent, `/nowhere/${agent}`]));
  return { ...bins, ...overrides } as AgentBins;
};

const installedOf = (agent: string, bins: AgentBins, probe?: (bin: string) => boolean) =>
  agentAvailability(bins, probe).find((entry) => entry.agent === agent)?.installed;

describe("agentAvailability", () => {
  it("answers one row per launchable agent, in the type's own order", () => {
    expect(agentAvailability(binsWhere(), () => false).map((entry) => entry.agent)).toEqual([...TERMINAL_AGENTS]);
  });

  it("reports an agent whose binary is nowhere as not installed", () => {
    expect(agentAvailability(binsWhere(), () => false).every((entry) => !entry.installed)).toBe(true);
  });

  it("asks the probe about the resolved bin, which is what the spawn will run", () => {
    const asked: string[] = [];
    agentAvailability(binsWhere({ codex: "/opt/bin/codex" }), (bin) => {
      asked.push(bin);
      return bin === "/opt/bin/codex";
    });
    expect(asked).toContain("/opt/bin/codex");
  });

  it("reports only the agents the probe recognises", () => {
    const bins = binsWhere({ codex: "/opt/bin/codex" });
    expect(installedOf("codex", bins, (bin) => bin === "/opt/bin/codex")).toBe(true);
    expect(installedOf("claude", bins, (bin) => bin === "/opt/bin/codex")).toBe(false);
  });
});

// The default probe is `hasBinary`, and these pin the answers that decide whether a user is told
// "install it", "chmod +x it", or nothing at all.
//
// THE EXECUTE-BIT RULE IS PINNED WITH A FAKE FILESYSTEM, not with real temp files, and that is the
// lesson this PR's first push paid for on `test_windows`. Two things vary per host and both have to
// be held still: an executable BIT is a POSIX idea (Windows has none — executability there is the
// extension, so an absolute path that exists is ok), AND the SHAPE of a temp path differs, so
// `/var/folders/...` is not absolute to `path.win32` and `C:\...` is not absolute to `path.posix`.
// Forcing the platform flag alone still asks the wrong question. `BinaryProbe` exists so the rules
// are "checkable from any host"; this uses it for that.
describe("the execute-bit rule, on both platforms", () => {
  const RUNNABLE = "/opt/bin/codex";
  const PRESENT_BUT_NOT_RUNNABLE = "/opt/bin/claude";
  const fakeFs: BinaryProbe = {
    isFile: (candidate) => candidate === RUNNABLE || candidate === PRESENT_BUT_NOT_RUNNABLE,
    isExecutable: (candidate) => candidate === RUNNABLE,
  };
  const bins = binsWhere({ codex: RUNNABLE, claude: PRESENT_BUT_NOT_RUNNABLE });
  const on = (platform: NodeJS.Platform) => (bin: string) => hasBinary(bin, {}, platform, fakeFs);

  // A file that is there but cannot be run is not an installed agent, and saying so is the
  // difference between "install it" and "chmod +x it".
  it("does not count a file that exists but is not executable, on a POSIX host", () => {
    expect(installedOf("codex", bins, on("linux"))).toBe(true);
    expect(installedOf("claude", bins, on("linux"))).toBe(false);
  });

  // Not a bug to fix: there is no bit to read on Windows, and reporting "not executable" there would
  // send a user chasing a permission that does not exist. The spawn's own error is the real answer.
  it("counts a file that exists on Windows, where there is no bit to read", () => {
    expect(installedOf("codex", bins, on("win32"))).toBe(true);
    expect(installedOf("claude", bins, on("win32"))).toBe(true);
  });

  it("counts neither when the path does not exist, on either platform", () => {
    const nowhere = binsWhere();
    expect(agentAvailability(nowhere, on("linux")).some((entry) => entry.installed)).toBe(false);
    expect(agentAvailability(nowhere, on("win32")).some((entry) => entry.installed)).toBe(false);
  });
});

// One test that does touch the real filesystem through the real probe, so the wiring above is not
// the only thing proven. Its assertions are the ones that hold on EVERY platform.
describe("the real filesystem, through the default probe", () => {
  it("counts an executable file and not a path that is not there", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-agents-"));
    try {
      const runnable = path.join(dir, "codex");
      writeFileSync(runnable, "#!/bin/sh\nexit 0\n");
      chmodSync(runnable, 0o755);
      const bins = binsWhere({ codex: runnable });
      expect(installedOf("codex", bins)).toBe(true);
      expect(installedOf("claude", bins)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Codex review, round 4, reproduced before accepting. The route's answer is what the launch form
// trusts to avoid OFFERING an agent that cannot run, so it has to be asked of the environment the
// SPAWN gets — which is what `diagnoseBinary`'s own docstring demands. `sanitizePtyEnv` strips the
// run-script PATH injections (`node_modules/.bin`, npm's node-gyp-bin, yarn's shim dir), so under
// `yarn dev` the two genuinely disagree: measured, a `muse` in `node_modules/.bin` answered true to
// `process.env` and false to the spawn's env, and the cell would then have refused with
// SpawnBinaryError.
describe("the environment the probe asks", () => {
  it("does not see a binary the spawn's PATH will not see", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-agents-nm-"));
    try {
      const injected = path.join(dir, "node_modules", ".bin");
      mkdirSync(injected, { recursive: true });
      const bin = path.join(injected, "muse");
      writeFileSync(bin, "#!/bin/sh\nexit 0\n");
      chmodSync(bin, 0o755);
      // A SECOND entry that survives sanitising, because an empty PATH is a degenerate case:
      // `diagnoseBinary` answers `ok` for a bare name when there is nowhere to look, which is the
      // "cannot be answered from here" posture and not a find. A real PATH always has other entries.
      const alsoOnPath = path.join(dir, "elsewhere");
      mkdirSync(alsoOnPath, { recursive: true });
      const env = { PATH: [injected, alsoOnPath].join(path.delimiter) };
      // The bare name, so the PATH decides — which is the only case the two environments can differ on.
      expect(hasBinary("muse", env), "a run-script PATH entry does find it").toBe(true);
      expect(hasBinary("muse", sanitizePtyEnv(env, path.delimiter)), "the spawn's PATH does not").toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
