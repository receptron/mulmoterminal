// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  bindHostFor,
  parsePortArg,
  chooseCwd,
  portInUseAction,
  portInUseMessage,
  secondInstancePrompt,
  runningInstancesPrompt,
  saysYes,
  SECOND_INSTANCE_NOTE,
  nodeMeetsMinimum,
  MIN_NODE_LABEL,
  serverNodeArgs,
  stopCommandFor,
} from "../../bin/cli-args.js";

// #1986: what npm enforces at install time lives in package.json, not in the doctor's constant.
// Read the manifest rather than restating the range, so the two cannot be edited apart.
const hasNodeEngine = (value: unknown): value is { engines: { node: string } } => {
  if (typeof value !== "object" || value === null || !("engines" in value)) return false;
  const { engines } = value;
  if (typeof engines !== "object" || engines === null || !("node" in engines)) return false;
  return typeof engines.node === "string";
};

const declaredNodeEngine = (): string => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  if (!hasNodeEngine(manifest)) throw new Error("package.json has no engines.node string");
  return manifest.engines.node;
};

const DEFAULT_PORT = 34567;
const port = (args: string[], env: Record<string, string | undefined> = {}) => parsePortArg(args, env, DEFAULT_PORT);
const cwd = (args: string[], env: Record<string, string | undefined> = {}) => chooseCwd(args, env);

describe("parsePortArg", () => {
  it("falls back to the default when neither the flag nor PORT is set", () => {
    expect(port([])).toEqual({ port: DEFAULT_PORT, explicit: false });
    expect(port(["--cwd", "/tmp"])).toEqual({ port: DEFAULT_PORT, explicit: false });
  });

  // #1861: PORT was read by nothing here, so `PORT=34601 npx mulmoterminal` started on 34567 —
  // while the busy-port message told the user to set exactly that. The order is bin/room.js's,
  // so the two entry points of this package cannot disagree about what a port is.
  describe("PORT from the environment", () => {
    it("is used when there is no flag", () => {
      expect(port([], { PORT: "34601" })).toEqual({ port: 34601, explicit: true });
    });

    it("loses to --port", () => {
      expect(port(["--port", "3000"], { PORT: "34601" })).toEqual({ port: 3000, explicit: true });
    });

    // `explicit` decides whether a busy port stops the launch or offers a second instance on
    // another one. The user named a port either way.
    it("counts as explicit, so a busy port is not silently swapped for a different one", () => {
      expect(port([], { PORT: "34601" })).toHaveProperty("explicit", true);
    });

    // An exported-but-empty PORT is not a value. `??` here would bind port 0.
    it.each(["", undefined])("falls through to the default for %o", (value) => {
      expect(port([], { PORT: value })).toEqual({ port: DEFAULT_PORT, explicit: false });
    });

    // Silently launching on the default is the bug being fixed, not the safe fallback.
    it.each(["abc", "80x", "0", "65536", "3000.5", "+3000", " 3000"])("refuses %s", (value) => {
      expect(port([], { PORT: value })).toHaveProperty("error");
    });

    it("names PORT, not --port, when PORT is the one at fault", () => {
      const result = port([], { PORT: "80x" });
      expect("error" in result && result.error).toContain("PORT");
      expect("error" in result && result.error).not.toContain("--port");
    });
  });

  // `explicit` is what decides whether a busy port is a hard error or a silent retry on
  // another one, so it has to distinguish "asked for" from "happens to be the default".
  it("marks a port the user asked for as explicit, even when it is the default", () => {
    expect(port(["--port", String(DEFAULT_PORT)])).toEqual({ port: DEFAULT_PORT, explicit: true });
  });

  it("takes a valid port", () => {
    expect(port(["--port", "3000"])).toEqual({ port: 3000, explicit: true });
  });

  it("reads the flag wherever it sits", () => {
    expect(port(["--cwd", "/tmp", "--port", "3000", "--foo"])).toEqual({ port: 3000, explicit: true });
  });

  describe("boundaries", () => {
    it.each([1, 80, 1024, 65535])("accepts %i", (value) => {
      expect(port(["--port", String(value)])).toEqual({ port: value, explicit: true });
    });

    it.each(["0", "65536", "-1", "99999"])("refuses %s", (value) => {
      expect(port(["--port", value])).toHaveProperty("error");
    });
  });

  // parseInt stops at the first non-digit, so a typo would otherwise launch on a port the
  // user never named — "80x" silently becoming 80 is worse than being told.
  describe("values that are not plainly an integer", () => {
    it.each([
      ["trailing letters", "80x"],
      ["a decimal", "3000.5"],
      ["padding", "0300"],
      ["a plus sign", "+3000"],
      ["surrounding space", " 3000"],
      ["a thousands separator", "3,000"],
      ["hex", "0x1f90"],
      ["words", "three thousand"],
      ["empty", ""],
    ])("refuses %s", (_label, value) => {
      expect(port(["--port", value])).toHaveProperty("error");
    });

    it("refuses a flag at the end of the arguments", () => {
      expect(port(["--port"])).toHaveProperty("error");
    });

    // Otherwise "--port --cwd /tmp" would swallow the next flag.
    it("refuses the next flag as a value", () => {
      expect(port(["--port", "--cwd", "/tmp"])).toHaveProperty("error");
    });

    it("names the offending value in the message", () => {
      const result = port(["--port", "80x"]);
      expect("error" in result && result.error).toContain('"80x"');
    });
  });
});

// Which address a port question is about. This is the whole of #1876: the probe asked about the
// `::` wildcard while the server bound loopback, so it reported a held port free and the
// second-instance guard never fired. A bind collides only with the SAME address.
describe("bindHostFor", () => {
  it("is loopback when the operator named no address", () => {
    expect(bindHostFor({})).toBe("127.0.0.1");
  });

  // Not a fixed 127.0.0.1: pinning it would re-break what #31 fixed, by missing a peer on the
  // wildcard for an operator who deliberately widened the bind.
  it("follows a widened bind, so the probe still matches what the server will do", () => {
    expect(bindHostFor({ MULMOTERMINAL_HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(bindHostFor({ MULMOTERMINAL_HOST: "::" })).toBe("::");
    expect(bindHostFor({ MULMOTERMINAL_HOST: "192.168.1.10" })).toBe("192.168.1.10");
  });

  // An exported-but-empty value is not an address; `??` here would hand `listen()` an empty
  // string. Same shape as the empty-PORT case in parsePortArg.
  it.each(["", undefined])("falls back to loopback for %o", (value) => {
    expect(bindHostFor({ MULMOTERMINAL_HOST: value })).toBe("127.0.0.1");
  });

  it("reads only the environment it is given", () => {
    const env = { MULMOTERMINAL_HOST: "0.0.0.0" };
    bindHostFor(env);
    expect(env).toEqual({ MULMOTERMINAL_HOST: "0.0.0.0" });
  });
});

// The workspace claude runs in, and whose sessions the sidebar lists — so this is a
// data-scope boundary, not a convenience.
describe("chooseCwd", () => {
  describe("precedence", () => {
    it("prefers the flag over the environment", () => {
      expect(cwd(["--cwd", "/from/flag"], { CLAUDE_CWD: "/from/env" })).toEqual({ path: "/from/flag", mustExist: true });
    });

    it("falls back to the environment", () => {
      expect(cwd([], { CLAUDE_CWD: "/from/env" })).toEqual({ path: "/from/env", mustExist: false });
    });

    it("falls back to where the launcher was run", () => {
      expect(cwd([], {})).toEqual({ path: ".", mustExist: false });
    });

    it("treats an unset environment variable as absent", () => {
      expect(cwd([], { CLAUDE_CWD: undefined })).toEqual({ path: ".", mustExist: false });
    });
  });

  // A typo in an explicit --cwd should stop the launch; an inherited CLAUDE_CWD naming a
  // directory that is not there yet is the managed workspace the server creates on boot.
  describe("which source has to exist already", () => {
    it("requires the flag's directory to exist", () => {
      expect(cwd(["--cwd", "/tmp"])).toHaveProperty("mustExist", true);
    });

    it("does not require the environment's to", () => {
      expect(cwd([], { CLAUDE_CWD: "/not/yet" })).toHaveProperty("mustExist", false);
    });
  });

  describe("relative and unusual paths are passed through", () => {
    it.each(["..", "./sub dir", "~/projects", "sub/dir/"])("keeps %o as written", (value) => {
      expect(cwd(["--cwd", value])).toEqual({ path: value, mustExist: true });
    });
  });

  describe("a missing value", () => {
    it("refuses the flag at the end of the arguments", () => {
      expect(cwd(["--cwd"])).toHaveProperty("error");
    });

    // Otherwise the launch would run in a directory called "--port".
    it("refuses the next flag as a value", () => {
      expect(cwd(["--cwd", "--port", "3000"])).toHaveProperty("error");
    });

    it("refuses a lone dash-prefixed value", () => {
      expect(cwd(["--cwd", "-"])).toHaveProperty("error");
    });
  });
});

// Running two servers is not a supported setup: they share ~/.mulmoterminal and the
// workspace while keeping their own PTYs, pub/sub and caches, so each is wrong about state
// it cannot see the other change. Starting a second one on another port without saying so —
// what a plain second `npx mulmoterminal` used to do — is how someone gets there by accident.
describe("portInUseMessage", () => {
  it("says the port is taken", () => {
    expect(portInUseMessage(34567, false)).toContain("Port 34567 is already in use");
  });

  // The first thing the user wants is the one that is already running.
  it("points at the server that is probably already there", () => {
    expect(portInUseMessage(34567, false)).toContain("http://localhost:34567");
  });

  it("uses the port it was given", () => {
    expect(portInUseMessage(3000, false)).toContain("http://localhost:3000");
    expect(portInUseMessage(3000, false)).not.toContain("34567");
  });

  describe("what to do about it", () => {
    // Without --port, the way to insist is to name one.
    it("offers --port when the port was the default", () => {
      expect(portInUseMessage(34567, false)).toContain("--port <number>");
    });

    // With --port already given, suggesting --port again says nothing.
    it("does not offer --port again when one was already given", () => {
      const explicit = portInUseMessage(3000, true);
      expect(explicit).not.toContain("--port <number>");
      expect(explicit).toContain("stop the other process");
    });
  });

  it("puts each part on its own line", () => {
    expect(portInUseMessage(34567, false).split("\n")).toHaveLength(3);
  });
});

describe("portInUseAction", () => {
  it("asks when the port was the default and someone is there to answer", () => {
    expect(portInUseAction(false, true)).toBe("ask");
  });

  // A prompt written to a pipe is never answered, so the start would hang rather than fail.
  it("stops rather than prompt with no terminal", () => {
    expect(portInUseAction(false, false)).toBe("stop");
    expect(portInUseAction(false, undefined)).toBe("stop");
  });

  // --port named the port that was wanted; a different one is not what was asked for.
  it("stops when the port was given explicitly", () => {
    expect(portInUseAction(true, true)).toBe("stop");
    expect(portInUseAction(true, false)).toBe("stop");
  });
});

describe("secondInstancePrompt", () => {
  it("names the port that is taken and where that server would be", () => {
    const asked = secondInstancePrompt(34567);
    expect(asked).toContain("34567");
    expect(asked).toContain("http://localhost:34567");
  });

  // "[y/N]" is the whole contract with saysYes: the capital N is what tells the reader
  // that Enter declines. A prompt claiming [Y/n] would be lying about the default.
  it("shows no as the default", () => {
    expect(secondInstancePrompt(34567)).toContain("[y/N]");
    expect(secondInstancePrompt(34567)).not.toContain("[Y/n]");
  });

  // readline writes the prompt as-is, so the trailing space is what keeps the typed
  // answer off the question mark.
  it("leaves room for the answer on the same line", () => {
    expect(secondInstancePrompt(34567).endsWith("] ")).toBe(true);
  });
});

describe("saysYes", () => {
  it("accepts the ways someone says yes", () => {
    ["y", "Y", "yes", "YES", "Yes", " y ", "\ty\n"].forEach((answer) => {
      expect(saysYes(answer), answer).toBe(true);
    });
  });

  // Enter is the common one: the prompt offered N as the default, so an empty line takes it.
  it("treats an empty answer as no", () => {
    expect(saysYes("")).toBe(false);
    expect(saysYes("   ")).toBe(false);
  });

  it("treats a no as no", () => {
    ["n", "N", "no", "NO"].forEach((answer) => expect(saysYes(answer), answer).toBe(false));
  });

  // Anything unrecognised declines rather than guessing. Starting a second server off a
  // mistyped word is the expensive direction to be wrong in; declining costs one retry.
  it("declines anything it does not recognise", () => {
    ["yolo", "yep", "ya", "sure", "yes please", "y/n", "1", "true"].forEach((answer) => expect(saysYes(answer), answer).toBe(false));
  });

  it("declines a missing answer", () => {
    expect(saysYes(undefined)).toBe(false);
    expect(saysYes(null)).toBe(false);
  });
});

describe("SECOND_INSTANCE_NOTE", () => {
  // The point of the note is the one thing that actually breaks with two instances.
  it("names the shared directory and what goes stale", () => {
    expect(SECOND_INSTANCE_NOTE).toContain("~/.mulmoterminal");
    expect(SECOND_INSTANCE_NOTE).toContain("live-update");
  });

  // It is printed just before the URL, in the middle of a start that is going ahead —
  // long enough to read at a glance, not a paragraph to scroll past.
  it("stays short", () => {
    expect(SECOND_INSTANCE_NOTE.split("\n")).toHaveLength(2);
  });
});

// The `init` pre-flight tick, fed process.versions.node ("22.12.0", "22.12.0-nightly…").
// Display-only: a wrong answer changes a ✓/✗, it never blocks the launch.
describe("nodeMeetsMinimum", () => {
  it("passes the minimum and anything above it", () => {
    expect(nodeMeetsMinimum("22.12.0")).toBe(true);
    expect(nodeMeetsMinimum("22.13.0")).toBe(true);
    expect(nodeMeetsMinimum("23.0.0")).toBe(true);
  });

  it("fails a lower minor on the boundary major", () => {
    expect(nodeMeetsMinimum("22.11.0")).toBe(false);
  });

  it("fails a lower major even with a high minor", () => {
    expect(nodeMeetsMinimum("21.12.0")).toBe(false);
  });

  // Number.parseInt stops at the first non-digit, so the nightly tag on the patch never
  // reaches the comparison — major.minor is all that gates.
  it("judges a nightly by its major.minor", () => {
    expect(nodeMeetsMinimum("22.12.0-nightly20240101abcd")).toBe(true);
    expect(nodeMeetsMinimum("22.11.0-nightly20240101abcd")).toBe(false);
  });

  // An unreadable version parses to NaN, and every comparison against NaN is false, so it
  // reads as "below minimum" — the safe direction for a check that only draws a tick.
  describe("an unreadable version reads as below minimum", () => {
    it.each(["", "not-a-version", "vvv", "22", "22.x"])("fails %o", (value) => {
      expect(nodeMeetsMinimum(value)).toBe(false);
    });
  });

  // The message's "needs ≥ x.y" and the comparison have to name the same minimum, or the
  // tick and the advice disagree.
  it("labels the minimum it enforces", () => {
    expect(MIN_NODE_LABEL).toBe("22.12");
    expect(nodeMeetsMinimum(`${MIN_NODE_LABEL}.0`)).toBe(true);
  });

  // #1986: `engines.node` was raised for a dependency and this label was not, so npm refused
  // an install the doctor had just ticked. Neither side's own tests could see the gap, because
  // each was self-consistent. Pin them to each other so the next engine bump goes red here.
  it("names the same minimum as the package's engines field", () => {
    const engine = declaredNodeEngine();
    const match = /^>=(\d+)\.(\d+)$/.exec(engine);
    expect(match, `engines.node is ${engine}, no longer ">=major.minor"`).not.toBeNull();
    expect(`${match?.[1]}.${match?.[2]}`).toBe(MIN_NODE_LABEL);
  });
});

describe("serverNodeArgs", () => {
  const ENTRY = "/pkg/server/index.ts";

  // The gap #795 closes: the dev scripts always passed this flag and the launcher never did,
  // so a key written into .env was silently absent from the server.
  it("reads .env from the launch directory, by absolute path", () => {
    expect(serverNodeArgs(ENTRY, "/home/u/project", 34567)).toContain(`--env-file-if-exists=${path.join("/home/u/project", ".env")}`);
  });

  // The spawn runs with cwd set to the package directory, so a relative path would be looked
  // for inside node_modules.
  it("does not pass a bare relative .env", () => {
    expect(serverNodeArgs(ENTRY, "/home/u/project", 34567)).not.toContain("--env-file-if-exists=.env");
  });

  // A node option after the script path is an argument to the script, not to node — and that
  // is exactly what --port has to be, so the entry script is the boundary between the two.
  it("keeps every node option ahead of the entry script, and --port behind it", () => {
    const args = serverNodeArgs(ENTRY, "/home/u/project", 34601);
    const entryAt = args.indexOf(ENTRY);
    expect(args.slice(0, entryAt).filter((a) => a.startsWith("--"))).toEqual(["--import", `--env-file-if-exists=${path.join("/home/u/project", ".env")}`]);
    expect(args.slice(entryAt + 1)).toEqual(["--port", "34601"]);
  });

  // #1857: the port used to travel in the environment, which the server hands to every PTY, so
  // a dev server started in a cell tried to take MulmoTerminal's own port. argv is not inherited.
  it("carries the port as a string argument", () => {
    expect(serverNodeArgs(ENTRY, "/home/u/project", 34601)).toContain("34601");
  });

  it("still loads tsx, which is what lets the server entry be TypeScript", () => {
    expect(serverNodeArgs(ENTRY, "/home/u/p", 34567).slice(0, 2)).toEqual(["--import", "tsx"]);
  });

  // No shell is involved in the spawn, so a directory with spaces needs no quoting — and
  // must not get any, or the path would carry literal quote characters.
  it("leaves a launch directory containing spaces as one unquoted argument", () => {
    const flag = serverNodeArgs(ENTRY, "/home/u/My Projects/app", 34567).find((a) => a.startsWith("--env-file"));
    expect(flag).toBe(`--env-file-if-exists=${path.join("/home/u/My Projects/app", ".env")}`);
    expect(flag).not.toContain('"');
  });
});

// The gap the field incident went through (#1061): the port prompt only fires when the wanted
// port is TAKEN, so `--port <free>` started a second instance in silence — and the two then
// shared ~/.mulmoterminal, where one deleted the other's live session settings.
describe("runningInstancesPrompt", () => {
  it("names where the running one is, so the user can go look before answering", () => {
    const text = runningInstancesPrompt([{ pid: 42, port: 34567 }]);
    expect(text).toContain("http://localhost:34567");
    expect(text).toContain("already running");
  });

  it("says plainly that this is not supported, and why", () => {
    // The port clash is a symptom; the shared home directory is the actual hazard, and it is
    // there at any port. Saying only "port in use" taught the wrong lesson.
    const text = runningInstancesPrompt([{ pid: 42, port: 34567 }]);
    expect(text).toContain("NOT a supported setup");
    expect(text).toContain("~/.mulmoterminal");
  });

  it("defaults to no", () => {
    expect(runningInstancesPrompt([{ pid: 42, port: 34567 }])).toContain("[y/N]");
  });

  it("counts them when more than one is up", () => {
    const text = runningInstancesPrompt([
      { pid: 1, port: 34567 },
      { pid: 2, port: 34568 },
    ]);
    expect(text).toContain("2 MulmoTerminal servers are already running");
  });

  it("falls back to the pid when an entry never recorded its port", () => {
    expect(runningInstancesPrompt([{ pid: 77, port: null }])).toContain("pid 77");
  });
});

// npx leaves no `mulmoterminal` on the PATH, so telling an npx user to run `mulmoterminal stop` in
// another terminal names a command they do not have (CodeRabbit on #1824).
describe("stopCommandFor", () => {
  it("tells an npx user to use npx", () => {
    expect(stopCommandFor("/Users/me/.npm/_npx/8f1a2b/node_modules/mulmoterminal")).toBe("npx mulmoterminal@latest stop");
  });

  it("recognises the Windows cache path too", () => {
    expect(stopCommandFor("C:\\Users\\me\\AppData\\npm-cache\\_npx\\8f1a2b\\node_modules\\mulmoterminal")).toBe("npx mulmoterminal@latest stop");
  });

  it("uses the short command for a global install", () => {
    expect(stopCommandFor("/usr/local/lib/node_modules/mulmoterminal")).toBe("mulmoterminal stop");
    expect(stopCommandFor("/Users/me/src/mulmoterminal")).toBe("mulmoterminal stop");
  });

  it("is what the already-running prompt prints", () => {
    const text = runningInstancesPrompt([{ pid: 42, port: 34567 }], "npx mulmoterminal@latest stop");
    expect(text).toContain("npx mulmoterminal@latest stop");
  });
});
