// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { CODEX_PERMISSION_HOOK_COMMAND, codexHookBody, codexPermissionHookOverride, wantsCodexPermissionHook } from "../../../server/agents/codex-hook.js";
import { activityHookEffects, pushKindFor } from "../../../server/session/activity-hook.js";

// Captured from codex 0.156.1 on macOS while its approval dialog was on screen.
const PERMISSION_REQUEST = {
  session_id: "01a0d782-f3c7-7b91-90a5-f42a6496d9a2",
  turn_id: "01a0d782-f5d6-7b81-931f-a78d001cffea",
  transcript_path: "/Users/u/.codex/sessions/2026/09/25/rollout-2026-09-25T16-41-18-01a0d782-f3c7-7b91-90a5-f42a6496d9a2.jsonl",
  cwd: "/tmp/probe",
  hook_event_name: "PermissionRequest",
  model: "gpt-5.6-luna",
  permission_mode: "default",
  tool_name: "Bash",
  tool_input: { command: "touch /tmp/cxprobe-p.txt .", description: "Allow creating /tmp/cxprobe-p.txt outside the sandbox?" },
};

describe("codexHookBody", () => {
  it("turns PermissionRequest into the Notification that reads as blocked", () => {
    expect(codexHookBody("PermissionRequest", PERMISSION_REQUEST)).toEqual({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      cwd: "/tmp/probe",
      message: "Allow creating /tmp/cxprobe-p.txt outside the sandbox?",
    });
  });

  it("never forwards codex's own session id, which is a uuid that is not ours", () => {
    expect(codexHookBody("PermissionRequest", PERMISSION_REQUEST)).not.toHaveProperty("session_id");
  });

  it("falls back to the command when the dialog gives no reason", () => {
    const input = { command: "rm -rf build" };
    expect(codexHookBody("PermissionRequest", { ...PERMISSION_REQUEST, tool_input: input })?.message).toBe("rm -rf build");
    expect(codexHookBody("PermissionRequest", { ...PERMISSION_REQUEST, tool_input: { ...input, description: "  " } })?.message).toBe("rm -rf build");
  });

  it("leaves the message empty when tool_input is missing or not an object", () => {
    for (const tool_input of [undefined, null, "cmd", ["cmd"], 3]) {
      expect(codexHookBody("PermissionRequest", { ...PERMISSION_REQUEST, tool_input })?.message).toBeUndefined();
    }
  });

  it("drops a non-string cwd rather than passing it on", () => {
    expect(codexHookBody("PermissionRequest", { ...PERMISSION_REQUEST, cwd: 42 })?.cwd).toBeUndefined();
  });

  it("answers null for any hook it did not register", () => {
    for (const name of [undefined, "", "Stop", "PreToolUse", "permissionRequest", "__proto__"]) {
      expect(codexHookBody(name, PERMISSION_REQUEST)).toBeNull();
    }
  });

  it("answers null for a payload that is not an object", () => {
    for (const payload of [undefined, null, "x", 1, [PERMISSION_REQUEST]]) {
      expect(codexHookBody("PermissionRequest", payload)).toBeNull();
    }
  });

  it("lands where claude's permission Notification lands: blocked when unwatched, and a waiting push", () => {
    const body = codexHookBody("PermissionRequest", PERMISSION_REQUEST);
    const event = String(body?.hook_event_name);
    const type = String(body?.notification_type);
    expect(activityHookEffects(event, false, type)).toEqual([{ kind: "waiting", value: true }]);
    expect(activityHookEffects(event, true, type)).toEqual([]);
    expect(pushKindFor(event, type)).toBe("waiting");
  });
});

describe("wantsCodexPermissionHook", () => {
  it("registers only for an interactive spawn off Windows", () => {
    expect(wantsCodexPermissionHook("darwin", false)).toBe(true);
    expect(wantsCodexPermissionHook("linux", false)).toBe(true);
    expect(wantsCodexPermissionHook("darwin", true)).toBe(false);
    expect(wantsCodexPermissionHook("win32", false)).toBe(false);
    expect(wantsCodexPermissionHook("win32", true)).toBe(false);
  });
});

describe("the hook command", () => {
  // codex re-asks the user to trust a hook whenever its hash changes, so the override must be the
  // same string for every session: nothing per-session may be baked in.
  it("carries no session or port, only the variables that name them", () => {
    expect(CODEX_PERMISSION_HOOK_COMMAND).toContain("$MULMOTERMINAL_SESSION_ID");
    expect(CODEX_PERMISSION_HOOK_COMMAND).toContain("$MULMOTERMINAL_PORT");
    expect(CODEX_PERMISSION_HOOK_COMMAND).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(codexPermissionHookOverride()).toBe(codexPermissionHookOverride());
  });

  // It sits inside a TOML literal string, which cannot contain a single quote.
  it("fits a TOML literal string", () => {
    expect(CODEX_PERMISSION_HOOK_COMMAND).not.toContain("'");
    expect(codexPermissionHookOverride()).toBe(`hooks.PermissionRequest=[{hooks=[{type="command",command='${CODEX_PERMISSION_HOOK_COMMAND}'}]}]`);
  });

  interface Received {
    url: string | undefined;
    headers: IncomingHttpHeaders;
    body: string;
  }

  // As codex runs it: through a shell, with the payload on stdin and the variables in the env.
  const runHook = async (env: Record<string, string>): Promise<{ exitCode: number | null; stdout: string }> => {
    const child = spawn("/bin/sh", ["-c", CODEX_PERMISSION_HOOK_COMMAND], { env: { PATH: process.env.PATH ?? "", ...env } });
    const stdout: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
    child.stdin.end(JSON.stringify(PERMISSION_REQUEST));
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { exitCode, stdout: stdout.join("") };
  };

  const runAgainstServer = async (env: Record<string, string>) => {
    const inbox: { received: Received | null } = { received: null };
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        inbox.received = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    try {
      const run = await runHook({ MULMOTERMINAL_PORT: String(address.port), ...env });
      return { ...run, received: inbox.received };
    } finally {
      server.close();
    }
  };

  // The headers the route dispatches on must arrive with the environment expanded, and nothing may
  // reach stdout, which codex reads as a decision.
  it.skipIf(process.platform === "win32")("posts the payload with the agent, hook and session headers", async () => {
    const session = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";
    const { received, exitCode, stdout } = await runAgainstServer({ MULMOTERMINAL_SESSION_ID: session });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    if (!received) throw new Error("the command posted nothing");
    expect(received.url).toBe("/api/hook");
    expect(received.headers["x-mt-agent"]).toBe("codex");
    expect(received.headers["x-mt-hook"]).toBe("PermissionRequest");
    expect(received.headers["x-mt-session"]).toBe(session);
    expect(received.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(received.body)).toEqual(PERMISSION_REQUEST);
  });

  it.skipIf(process.platform === "win32")("exits 0 when nothing is listening, so a stopped server cannot read as a refusal", async () => {
    expect((await runHook({ MULMOTERMINAL_PORT: "1" })).exitCode).toBe(0);
  });
});
