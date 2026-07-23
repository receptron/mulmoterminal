import { describe, it, expect } from "vitest";

import { parsePortArg, chooseCwd, portInUseAction, portInUseMessage, secondInstancePrompt, saysYes, SECOND_INSTANCE_NOTE } from "../../bin/cli-args.js";

const DEFAULT_PORT = 34567;
const port = (args: string[]) => parsePortArg(args, DEFAULT_PORT);
const cwd = (args: string[], env: Record<string, string | undefined> = {}) => chooseCwd(args, env);

describe("parsePortArg", () => {
  it("falls back to the default when the flag is absent", () => {
    expect(port([])).toEqual({ port: DEFAULT_PORT, explicit: false });
    expect(port(["--cwd", "/tmp"])).toEqual({ port: DEFAULT_PORT, explicit: false });
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
