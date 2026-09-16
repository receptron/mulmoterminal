// @vitest-environment node
import { assert, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abandonBotInput,
  botInputReady,
  claimBotInput,
  deferDuringBotDelivery,
  forgetBotInput,
  noteBotUserInput,
  observeBotInputHook,
  recoverBotInput,
} from "../../../server/bots/input-gate.js";
const id = "test-frontend";
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  forgetBotInput(id);
  vi.useRealTimers();
});
const stop = () => {
  observeBotInputHook(id, "Stop");
  vi.advanceTimersByTime(750);
};

describe("Bot input boundaries", () => {
  it("recovers unknown input only, preserving drafts and newer lifecycle events", () => {
    recoverBotInput(id);
    expect(botInputReady(id)).toBe(false);
    vi.advanceTimersByTime(750);
    expect(botInputReady(id)).toBe(true);
    observeBotInputHook(id, "UserPromptSubmit");
    recoverBotInput(id);
    vi.advanceTimersByTime(750);
    expect(botInputReady(id)).toBe(false);
    forgetBotInput(id);
    noteBotUserInput(id);
    recoverBotInput(id);
    vi.advanceTimersByTime(750);
    expect(botInputReady(id)).toBe(false);
  });
  it("holds unknown, busy, blocked, and unsubmitted drafts regardless of silence", () => {
    expect(botInputReady(id)).toBe(false);
    stop();
    expect(botInputReady(id)).toBe(true);
    noteBotUserInput(id);
    vi.advanceTimersByTime(60000);
    expect(botInputReady(id)).toBe(false);
    stop();
    expect(botInputReady(id)).toBe(false);
    observeBotInputHook(id, "UserPromptSubmit");
    expect(botInputReady(id)).toBe(false);
    stop();
    expect(botInputReady(id)).toBe(true);
    observeBotInputHook(id, "Notification");
    expect(botInputReady(id)).toBe(false);
  });
  it("waits for the hook to finish before typing and defers concurrent user input until submission acknowledgement", () => {
    observeBotInputHook(id, "Stop");
    expect(claimBotInput(id)).toBeNull();
    vi.advanceTimersByTime(750);
    expect(claimBotInput(id)).not.toBeNull();
    const write = vi.fn(() => noteBotUserInput(id));
    expect(deferDuringBotDelivery(id, write)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    observeBotInputHook(id, "UserPromptSubmit");
    expect(write).toHaveBeenCalledOnce();
    stop();
    expect(botInputReady(id)).toBe(false); // user's new draft is still protected
  });
  it("never lets a prior delivery timeout abandon a later delivery", () => {
    stop();
    const first = claimBotInput(id);
    assert(first !== null);
    observeBotInputHook(id, "UserPromptSubmit");
    stop();
    const second = claimBotInput(id);
    assert(second !== null);
    const write = vi.fn();
    deferDuringBotDelivery(id, write);
    abandonBotInput(id, first);
    expect(write).not.toHaveBeenCalled();
    abandonBotInput(id, second);
    expect(write).toHaveBeenCalledOnce();
    stop();
    expect(botInputReady(id)).toBe(false); // partial/uncertain paste is a draft
  });
  it("compact finishes only at its SessionStart boundary", () => {
    stop();
    claimBotInput(id);
    observeBotInputHook(id, "PreCompact");
    expect(botInputReady(id)).toBe(false);
    observeBotInputHook(id, "SessionStart", "compact");
    vi.advanceTimersByTime(750);
    expect(botInputReady(id)).toBe(true);
  });
});
