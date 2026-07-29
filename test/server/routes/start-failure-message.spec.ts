import { describe, it, expect } from "vitest";

import { startFailureMessageFor } from "../../../server/routes/ws-routes.js";
import { SpawnBinaryError, SpawnCwdError } from "../../../server/session/pty-spawn.js";

// The one decision this PR family turns on (#1063, #1078): a refusal that was written FOR the
// reader must reach the terminal unchanged. Wrapping it is how the user ended up looking at
// `spawn ENOENT` — or at a guess — instead of the reason.
describe("startFailureMessageFor", () => {
  const message = startFailureMessageFor("codex");

  it("passes a binary refusal through untouched", () => {
    const err = new SpawnBinaryError("`codex` is not on the PATH this server spawns with…", { kind: "missing", searched: ["/usr/bin"] });
    expect(message(err)).toBe("`codex` is not on the PATH this server spawns with…");
  });

  it("passes a cwd refusal through untouched", () => {
    const err = new SpawnCwdError("The directory /gone no longer exists…", { kind: "missing" });
    expect(message(err)).toBe("The directory /gone no longer exists…");
  });

  // Anything else is an error nobody wrote for a reader, so it gets named — otherwise the banner
  // is a bare errno with no hint of which program failed.
  it("names the program for an error that explains nothing on its own", () => {
    expect(message(new Error("spawn ENOENT"))).toBe("Failed to start codex: spawn ENOENT");
  });

  it("uses the caller's wording", () => {
    expect(startFailureMessageFor("the launch command")(new Error("boom"))).toBe("Failed to start the launch command: boom");
  });
});
