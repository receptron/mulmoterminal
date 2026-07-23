import { describe, it, expect } from "vitest";
import { activityHookEffects, buildPushText, pushKindFor, resolveHookSessionId } from "../../../server/session/activity-hook.js";

describe("activityHookEffects", () => {
  it("UserPromptSubmit sets working regardless of active", () => {
    expect(activityHookEffects("UserPromptSubmit", true)).toEqual([{ kind: "working", value: true }]);
    expect(activityHookEffects("UserPromptSubmit", false)).toEqual([{ kind: "working", value: true }]);
  });

  // A tool call is the middle of a live turn, so it re-asserts working. This is what lets a
  // long turn recover its status after a --watch restart lost it: `working` is otherwise only
  // set at the prompt and cleared at Stop, and a stop can be an hour away. Independent of
  // `active` — the same rule as the prompt.
  it.each(["PreToolUse", "PostToolUse", "PostToolUseFailure"])("%s re-asserts working regardless of active", (event) => {
    expect(activityHookEffects(event, true)).toEqual([{ kind: "working", value: true }]);
    expect(activityHookEffects(event, false)).toEqual([{ kind: "working", value: true }]);
  });

  it("Stop on the actively-viewed pane clears working only (no attention flag)", () => {
    expect(activityHookEffects("Stop", true)).toEqual([{ kind: "working", value: false }]);
  });

  it("Stop on an inactive pane (e.g. an unfocused grid cell) flags done, then clears working", () => {
    // Regression for #321 #5-symptom: a finished on-screen grid cell was stuck idle
    // because it counted as foreground. Order matters: waiting before working.
    expect(activityHookEffects("Stop", false)).toEqual([
      { kind: "waiting", value: true },
      { kind: "working", value: false },
    ]);
  });

  it("Notification on the actively-viewed pane does nothing", () => {
    expect(activityHookEffects("Notification", true)).toEqual([]);
  });

  it("Notification on an inactive pane flags blocked", () => {
    // Regression for #321 #1: an on-screen grid cell blocked on a permission prompt
    // showed 'Working…' instead of amber because it counted as foreground.
    expect(activityHookEffects("Notification", false)).toEqual([{ kind: "waiting", value: true }]);
  });

  it("ignores events that are neither a turn boundary nor tool activity", () => {
    // SessionStart fires before any prompt — the session exists but isn't working yet.
    expect(activityHookEffects("SessionStart", true)).toEqual([]);
    expect(activityHookEffects("PreCompact", false)).toEqual([]);
    expect(activityHookEffects("", false)).toEqual([]);
  });
});

describe("pushKindFor", () => {
  // A finished turn and a blocked one both reach the phone, and mean different things.
  it("maps a finished turn to 'finished'", () => {
    expect(pushKindFor("Stop")).toBe("finished");
  });

  // The one this feature adds: a paused turn is where the user can actually help.
  it("maps a paused turn (Notification) to 'waiting'", () => {
    expect(pushKindFor("Notification")).toBe("waiting");
  });

  it("is null for events that are neither a finish nor a block", () => {
    expect(pushKindFor("UserPromptSubmit")).toBeNull();
    expect(pushKindFor("PreToolUse")).toBeNull();
    expect(pushKindFor("SessionStart")).toBeNull();
  });
});

describe("buildPushText", () => {
  const limits = { title: 80, body: 160 };

  it("marks a finished turn with a check and shows what the agent reported", () => {
    const { title, body } = buildPushText("finished", "myrepo", "パーサの丸め誤差を修正しました", "", limits);
    expect(title).toBe("\u2705 myrepo");
    expect(body).toBe("パーサの丸め誤差を修正しました");
  });

  // The finished body is the agent's reply now, so it arrives as markdown. Left as-is the
  // newlines and indentation would eat the 160-character budget before the point lands.
  it("collapses a multi-line reply into one line", () => {
    const reply = "作業ログを追記しました。\n\n- dev-log-2026-w29.md   （3リポ分）\n- worklog.md にリンク追加";
    expect(buildPushText("finished", "myrepo", reply, "", limits).body).toBe(
      "作業ログを追記しました。 - dev-log-2026-w29.md （3リポ分） - worklog.md にリンク追加",
    );
  });

  it("collapses a multi-line waiting message too", () => {
    expect(buildPushText("waiting", "myrepo", "", "Bash を実行する\n許可が必要です", limits).body).toBe("Bash を実行する 許可が必要です");
  });

  it("flattens a markdown link to its text, keeping the URL out of the budget", () => {
    const reply = "issue [receptron/mulmoserver#81](https://github.com/receptron/mulmoserver/issues/81) を作成しました";
    expect(buildPushText("finished", "myrepo", reply, "", limits).body).toBe("issue receptron/mulmoserver#81 を作成しました");
  });

  it("keeps text verbatim when a bracket never closes into a link", () => {
    expect(buildPushText("finished", "myrepo", "配列 [0] を [未完了 のまま", "", limits).body).toBe("配列 [0] を [未完了 のまま");
  });

  it("flattens several links in one reply", () => {
    const reply = "[#1](https://x/1) と [#2](https://x/2) を閉じました";
    expect(buildPushText("finished", "myrepo", reply, "", limits).body).toBe("#1 と #2 を閉じました");
  });

  it("drops emphasis markers but keeps a leading # (it starts an issue number)", () => {
    expect(buildPushText("finished", "myrepo", "**#300 マージ完了** — done", "", limits).body).toBe("#300 マージ完了 — done");
  });

  it("treats a whitespace-only reply as absent and falls back", () => {
    expect(buildPushText("finished", "myrepo", " \n\t ", "", limits).body).toBe("タスクが完了しました");
  });

  it("marks a waiting turn with a question and quotes the hook's message", () => {
    const { title, body } = buildPushText("waiting", "myrepo", "fix the parser", "Claude needs permission to run Bash", limits);
    expect(title).toBe("\u2753 myrepo");
    // The message (what it is blocked ON) beats the prompt — that is what the user answers.
    expect(body).toBe("Claude needs permission to run Bash");
  });

  it("falls back to the prompt, then a default, when a waiting hook carries no message", () => {
    expect(buildPushText("waiting", "myrepo", "fix the parser", "", limits).body).toBe("fix the parser");
    expect(buildPushText("waiting", "myrepo", "", "  ", limits).body).toBe("\u5165\u529b\u5f85\u3061\u3067\u3059");
  });

  it("clips title and body to the limits", () => {
    const { title, body } = buildPushText("finished", "d".repeat(200), "p".repeat(400), "", limits);
    expect(title).toHaveLength(80);
    expect(body).toHaveLength(160);
  });
});

describe("resolveHookSessionId", () => {
  const UUID = "8b1f2c4e-0000-4aaa-9bbb-ccddeeff0011";
  const OTHER = "11111111-2222-4333-8444-555555555555";
  const isValidId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const resolve = (header: unknown, body: unknown) => resolveHookSessionId(header, body, isValidId);

  // Claude reissues its own session_id on /clear and /compact; the mulmoterminal id is
  // the one hooks must stay attributed to.
  it("prefers the mulmoterminal header over Claude's own id", () => {
    expect(resolve(UUID, OTHER)).toBe(UUID);
  });

  it("falls back to the body when no header is present", () => {
    expect(resolve(undefined, UUID)).toBe(UUID);
  });

  // The fallback used to skip the shape check the header path applied.
  it("validates the body fallback, not just the header", () => {
    expect(resolve(undefined, "not-a-uuid")).toBeNull();
    expect(resolve(undefined, "")).toBeNull();
  });

  it("falls through to the body when the header is malformed", () => {
    expect(resolve("garbage", UUID)).toBe(UUID);
  });

  // The id becomes a Firestore document id. A value with a path separator would change
  // the document's depth rather than address a session.
  it("rejects an id carrying a path separator", () => {
    expect(resolve(undefined, `${UUID}/../../other`)).toBeNull();
    expect(resolve(undefined, "a/b")).toBeNull();
  });

  it("rejects non-string sources", () => {
    for (const value of [42, true, null, undefined, { id: UUID }, [UUID]]) {
      expect(resolve(value, value)).toBeNull();
    }
  });

  it("accepts either case, since the shape check is case-insensitive", () => {
    expect(resolve(undefined, UUID.toUpperCase())).toBe(UUID.toUpperCase());
  });
});
