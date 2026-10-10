import { describe, it, expect } from "vitest";
import { isTmuxPrefix, sanitizeTmuxPrefix, tmuxPrefixCommands, TMUX_PREFIX_CHOICES, TMUX_PREFIX_LABEL_KEYS } from "../../common/tmuxPrefix";

describe("tmuxPrefix (#2981)", () => {
  it.each(["none", "C-b", "C-]", "C-a", "C-Space", "C-_", "C-^", "C-@"])("accepts %s", (key) => {
    expect(isTmuxPrefix(key)).toBe(true);
  });

  it.each(["", "None", "c-b", "C-B", "C-bb", "C-;", "C-b; kill-server", "M-b", "C-#", "C-'", 5, null, undefined, {}])("rejects %j", (key) => {
    expect(isTmuxPrefix(key)).toBe(false);
    expect(sanitizeTmuxPrefix(key)).toBe("none");
  });

  it("offers only values it accepts", () => {
    expect(TMUX_PREFIX_CHOICES.every(isTmuxPrefix)).toBe(true);
  });

  it("has a label key for every choice, none of which holds a path character", () => {
    expect(TMUX_PREFIX_CHOICES.map((choice) => TMUX_PREFIX_LABEL_KEYS[choice])).toEqual(["none", "ctrlB", "ctrlBracket"]);
  });

  it("turns the prefix off and unbinds C-b for none", () => {
    expect(tmuxPrefixCommands("none")).toEqual(["set -g prefix None", "unbind-key C-b"]);
  });

  it("restores tmux's own binding for C-b, so a running server can be put back", () => {
    expect(tmuxPrefixCommands("C-b")).toEqual(["set -g prefix C-b", "bind-key C-b send-prefix"]);
  });

  it("moves the prefix to another key and frees C-b", () => {
    expect(tmuxPrefixCommands("C-]")).toEqual(["set -g prefix C-]", "unbind-key C-b", "bind-key C-] send-prefix"]);
  });
});
