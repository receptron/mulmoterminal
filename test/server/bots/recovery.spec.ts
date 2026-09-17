// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotRecovery, idleBotScreen } from "../../../server/bots/recovery.js";

const bar = "─".repeat(80);
const screen = (input = "", footer = "auto mode on (shift+tab to cycle)") => `Finished.\n${bar}\n❯ ${input}\n${bar}\n${footer}\n`;
afterEach(() => vi.useRealTimers());

describe("surviving Bot screen recovery", () => {
  it("recognizes an empty current input box and dim suggestions, including wrapped ones", () => {
    expect(idleBotScreen(screen())).not.toBeNull();
    expect(idleBotScreen(screen("\u001b[2m次号のテーマを相談したい\u001b[0m"))).not.toBeNull();
    expect(idleBotScreen(screen("\u001b[2mA suggested\u001b[0m\n\u001b[2mcontinuation\u001b[0m"))).not.toBeNull();
    expect(idleBotScreen(screen("", "? for shortcuts"))).not.toBeNull();
  });

  it("recognizes the standalone styled editor badge but never a draft or plain lookalike", () => {
    const badge = "\u001b[38;5;74m[⧉ In 22.md]\u001b[39m";
    expect(idleBotScreen(screen(badge))).not.toBeNull();
    expect(idleBotScreen(screen(badge).replace("❯ ", "\u001b[39m❯\u00a0"))).not.toBeNull();
    for (const input of ["[⧉ In 22.md]", badge + "typed", "typed" + badge, badge + "\nwrapped draft", "\u001b[38;5;74m[⧉ In 22.md]typed\u001b[39m"]) {
      expect(idleBotScreen(screen(input))).toBeNull();
    }
  });

  it.each([
    screen("unfinished draft"),
    screen("\u001b[2msuggestion\u001b[0mtyped"),
    screen("\n  wrapped draft"),
    screen("", "auto mode on (shift+tab to cycle) · esc to interrupt"),
    screen("", "Enter to confirm · Esc to cancel"),
    screen() + "Do you trust this folder?\nEnter to confirm",
    "? for shortcuts\n" + screen("", "unknown footer"),
    "? for shortcuts\n❯ ",
    "",
  ])("refuses drafts, busy screens, dialogs and unknown layouts", (value) => {
    expect(idleBotScreen(value)).toBeNull();
  });

  it("requires two stable captures and forgets candidates when lifecycle hooks arrive", () => {
    vi.useFakeTimers();
    const recovery = new BotRecovery();
    recovery.add("idle");
    recovery.add("busy");
    recovery.add("missing");
    recovery.add("hook");
    const capture = vi.fn((id: string) => (id === "missing" ? null : screen()));
    const phase = (id: string) => (id === "busy" ? "busy" : "unknown");
    const recovered = vi.fn();
    recovery.check(phase, capture, recovered);
    expect(recovered).not.toHaveBeenCalled();
    vi.advanceTimersByTime(750);
    recovery.check((id) => (id === "hook" ? "blocked" : phase(id)), capture, recovered);
    expect(recovered).toHaveBeenCalledExactlyOnceWith("idle");
    expect(capture).not.toHaveBeenCalledWith("busy");
    recovery.check(() => "unknown", capture, recovered);
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("resets the settling interval when the box changes or capture fails", () => {
    vi.useFakeTimers();
    const recovery = new BotRecovery();
    recovery.add("bot");
    const capture = vi.fn<() => string | null>(() => screen());
    const recovered = vi.fn();
    recovery.check(() => "unknown", capture, recovered);
    vi.advanceTimersByTime(750);
    capture.mockReturnValue(null);
    recovery.check(() => "unknown", capture, recovered);
    capture.mockReturnValue(screen());
    recovery.check(() => "unknown", capture, recovered);
    vi.advanceTimersByTime(750);
    capture.mockReturnValue(screen("\u001b[2msuggestion\u001b[0m"));
    recovery.check(() => "unknown", capture, recovered);
    expect(recovered).not.toHaveBeenCalled();
    vi.advanceTimersByTime(750);
    recovery.check(() => "unknown", capture, recovered);
    expect(recovered).toHaveBeenCalledExactlyOnceWith("bot");
  });
});
