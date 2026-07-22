import { describe, it, expect } from "vitest";

import { hookSettingsJson } from "../../../server/session/hook-settings.js";
import { SESSION_ID_RE } from "../../../server/config/env.js";

const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const settings = (over: Partial<Parameters<typeof hookSettingsJson>[0]> = {}) =>
  JSON.parse(hookSettingsJson({ host: "localhost", port: 34567, sessionId: SESSION, ...over }));

const HOOK_EVENTS = ["UserPromptSubmit", "Stop", "Notification", "SessionStart"] as const;
const TOOL_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const;

const commandOf = (entry: { hooks: { command: string }[] }): string => entry.hooks[0].command;

describe("hookSettingsJson", () => {
  it("registers every event the session's bookkeeping depends on", () => {
    expect(Object.keys(settings().hooks)).toEqual([...HOOK_EVENTS, ...TOOL_EVENTS]);
  });

  it("points every hook at this server's /api/hook", () => {
    const { hooks } = settings({ host: "127.0.0.1", port: 5555 });
    const commands = [...HOOK_EVENTS, ...TOOL_EVENTS].map((event) => commandOf(hooks[event][0]));
    commands.forEach((command) => expect(command).toContain("http://127.0.0.1:5555/api/hook"));
  });

  it("takes the port as given, whether a number or a string", () => {
    expect(commandOf(settings({ port: "8080" }).hooks.Stop[0])).toContain(":8080/api/hook");
    expect(commandOf(settings({ port: 8080 }).hooks.Stop[0])).toContain(":8080/api/hook");
  });

  // The PTY's id, not claude's — claude reissues its own on /clear and /compact, and the
  // header is what keeps activity, header prompt and tool history correlated across one.
  it("tags every hook with the stable session id", () => {
    const { hooks } = settings();
    [...HOOK_EVENTS, ...TOOL_EVENTS].forEach((event) => expect(commandOf(hooks[event][0])).toContain(`x-mt-session: ${SESSION}`));
  });

  it("gives tool hooks the matcher that matches every tool", () => {
    TOOL_EVENTS.forEach((event) => expect(settings().hooks[event][0].matcher).toBe(""));
  });

  it("gives lifecycle hooks no matcher", () => {
    HOOK_EVENTS.forEach((event) => expect(settings().hooks[event][0]).not.toHaveProperty("matcher"));
  });

  // A failed tool fires PostToolUseFailure and NOT PostToolUse. Registering only the latter
  // leaves the failed call stuck on "running" in the tools pane forever.
  it("registers the failure event alongside the success one, so a failed call still completes", () => {
    const { hooks } = settings();
    expect(commandOf(hooks.PostToolUseFailure[0])).toBe(commandOf(hooks.PostToolUse[0]));
  });

  describe("the env block", () => {
    // It is the one part of these settings that can hold a provider's API token, and its
    // presence is what makes the caller write the settings to a 0600 file instead of argv.
    it("is absent entirely when there is nothing to set", () => {
      expect(settings()).not.toHaveProperty("env");
      expect(settings({ env: {} })).not.toHaveProperty("env");
    });

    it("carries the provider environment when there is one", () => {
      const env = { ANTHROPIC_BASE_URL: "https://openrouter.ai/api", ANTHROPIC_AUTH_TOKEN: "sk-or-secret" };
      expect(settings({ env }).env).toEqual(env);
    });

    it("keeps the hooks intact when an env block is present", () => {
      const withEnv = settings({ env: { ANTHROPIC_MODEL: "moonshotai/kimi-k2.7-code" } });
      expect(Object.keys(withEnv.hooks)).toEqual([...HOOK_EVENTS, ...TOOL_EVENTS]);
    });
  });

  it("produces parseable JSON", () => {
    expect(() => JSON.parse(hookSettingsJson({ host: "localhost", port: 34567, sessionId: SESSION }))).not.toThrow();
  });

  // The id is interpolated into a shell command inside single quotes, so the safety of that
  // interpolation rests entirely on the id's shape being guaranteed upstream. Every caller
  // takes its id from randomUUID() or a SESSION_ID_RE match — pinned here so a later
  // loosening of that pattern fails a test instead of opening a hook-command injection.
  describe("the id shape the single-quoted interpolation relies on", () => {
    it("lands the id inside the quoted header", () => {
      expect(commandOf(settings().hooks.Stop[0])).toContain(`-H 'x-mt-session: ${SESSION}' `);
    });

    it.each(["'; touch /tmp/pwned; '", "a'b", `"; id; "`, "../../etc/passwd", ""])("rejects %o upstream, so it can never be interpolated", (id) => {
      expect(SESSION_ID_RE.test(id)).toBe(false);
    });

    it("accepts the uuid shape the spawners generate", () => {
      expect(SESSION_ID_RE.test(SESSION)).toBe(true);
    });
  });
});
