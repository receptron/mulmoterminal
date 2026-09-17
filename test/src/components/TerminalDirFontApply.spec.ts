import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { TerminalFont } from "../../../src/composables/useTerminalConnections";
import { TERMINAL_FONT_FAMILY_DEFAULT } from "../../../common/terminalFontFamily";
import { TERMINAL_FONT_SIZE_DEFAULT } from "../../../common/terminalFontSize";
import { THEME_VAR_KEYS, type ThemeVars } from "../../../common/themeVars";
import { setCustomThemes } from "../../../src/composables/customThemes";
import { useTheme } from "../../../src/composables/useTheme";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// The seam under test. attach() takes the font the terminal is BUILT with; setFont() is the only
// path that changes it afterwards — and the only one that re-fits and tells the PTY.
const attached: TerminalFont[] = [];
const setFontCalls: TerminalFont[] = [];
const setThemeCalls: unknown[] = [];
// The palette a terminal is BUILT with. `setTheme` only carries a LATER change, so a spec whose
// theme is already resolved at mount finds nothing there — the value went through attach().
const attachedThemes: unknown[] = [];
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  return {
    connView: reactive(new Map()),
    attach: (_k: string, _t: unknown, _h: unknown, _el: unknown, theme: unknown, font: TerminalFont) => {
      attachedThemes.push(theme);
      attached.push(font);
    },
    setFont: (_k: string, font: TerminalFont) => setFontCalls.push(font),
    setTheme: (_k: string, theme: unknown) => setThemeCalls.push(theme),
    detach: () => {},
    release: () => {},
    retarget: () => {},
    terminate: () => {},
    fit: () => {},
    focus: () => {},
    insertText: () => {},
    sendView: () => {},
    readBuffer: () => null,
    submitText: () => true,
    isClaudeTarget: () => false,
  };
});

// jsdom has no ResizeObserver and Terminal.vue constructs one on mount. The auto-fit it drives is
// not what these specs are about — the font seam is — so a no-op stub is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Nothing is passed down any more: Terminal.vue resolves the directory's look from its own cwd
// (#909), so a spec drives it the way the real app does — by answering /api/dir-config.
function serveDirConfig(dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

// The theme selection and the user's themes are module-level singletons, so a spec that changes
// either has to put them back or the next one starts on someone else's palette.
const { setTheme } = useTheme();

beforeEach(() => {
  attached.length = 0;
  attachedThemes.length = 0;
  setFontCalls.length = 0;
  setThemeCalls.length = 0;
  setCustomThemes([]);
  setTheme("midnight");
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

// At module scope, not inside a test: a component's module load is not the test's work, and
// billing it to `testTimeout` is what makes the first test of a file the one that flakes.
const Terminal = (await import("../../../src/components/Terminal.vue")).default;

async function mountTerminal(slot: string) {
  return mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: slot, cwd: `/proj/${slot}` } });
}

describe("Terminal.vue resolves its directory's look from its own cwd", () => {
  // The load-bearing case, and the reason the props were removed. useDirConfig has nothing cached
  // on a fresh page load, so the terminal is BUILT with the app-wide font and the directory's
  // arrives only when /api/dir-config resolves. If this watcher does not fire, a dir-pinned font
  // never applies at all — indistinguishable, from the user's side, from the feature being broken.
  it("applies the directory's font once the config resolves, via setFont so it re-fits", async () => {
    serveDirConfig({ fontSize: 20, fontFamily: "Songti SC, monospace" });
    await mountTerminal("pinned");
    await flushPromises();

    expect(attached[0]).toEqual({ size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT });
    expect(setFontCalls.at(-1)).toEqual({ size: 20, family: "Songti SC, monospace" });
  });

  it("applies the directory's palette the same way", async () => {
    serveDirConfig({ colors: { background: "#190a23" } });
    await mountTerminal("palette");
    await flushPromises();

    expect(setThemeCalls.at(-1)).toMatchObject({ background: "#190a23" });
  });

  // No `.mulmoterminal.json` is the overwhelmingly common case: it must leave the app-wide values
  // alone rather than push a redundant re-fit at every terminal on every load.
  it("leaves the app-wide font alone when the directory pins nothing", async () => {
    serveDirConfig({});
    await mountTerminal("plain");
    await flushPromises();

    expect(attached[0]).toEqual({ size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT });
    expect(setFontCalls).toHaveLength(0);
  });

  // The parser is the trust boundary — the server validates, but an unusable stack would otherwise
  // reach the canvas renderer straight off the wire.
  it("ignores an unusable stack rather than passing it to the canvas", async () => {
    serveDirConfig({ fontFamily: "Cica; color: red" });
    await mountTerminal("garbage");
    await flushPromises();

    expect(setFontCalls).toHaveLength(0);
  });
});

// The single view leaves `cwd` unset on purpose — passing it would put `?cwd=` on the WebSocket
// and change what the server connects to — so it hands the directory in separately. Without this
// its palette would resolve only once the session reported back, i.e. a visible flash of the
// app-wide theme first, which is the regression this hint exists to prevent.
describe("Terminal.vue falls back to the dirCwd hint when it has no cwd", () => {
  it("resolves the directory's font from dirCwd alone", async () => {
    serveDirConfig({ fontSize: 18, fontFamily: "Cica, monospace" });
    const w = mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: "hinted", dirCwd: "/proj/hinted" } });
    await flushPromises();

    expect(setFontCalls.at(-1)).toEqual({ size: 18, family: "Cica, monospace" });
    w.unmount();
  });
});

// A custom theme naming every variable, which is what makes it resolvable with no built-in base:
// jsdom loads no stylesheet, so `readBuiltinVars` finds nothing and `extends` would resolve to
// nothing either. The three keys spelled out are the ones the xterm palette is derived from.
const WASHI_BG = "#ece7dc";
const WASHI_FG = "#33302b";
const washiColors = (): Partial<ThemeVars> => {
  const filled: Partial<ThemeVars> = {};
  THEME_VAR_KEYS.forEach((key) => {
    filled[key] = "#808080";
  });
  return { ...filled, "--bg-base": WASHI_BG, "--term-fg": WASHI_FG, "--term-selection": "#d8cfbb" };
};
const washi = () => ({ id: "washi", label: "Washi", colors: washiColors() });

describe("Terminal.vue repaints its canvas once the user's own themes arrive", () => {
  // #1943. On a reload the selected id is read from localStorage and resolves to nothing until
  // /api/config lands, so the terminal is BUILT on the built-in default — and the id never changes
  // when the themes arrive. Watching the inputs by name missed this one, and the canvas kept the
  // dark default under a light chrome until the user re-picked a theme in Settings.
  it("applies a custom theme selected before its definition was known", async () => {
    serveDirConfig({});
    setTheme("washi"); // selected while `themes` is still empty, exactly as a reload leaves it
    await mountTerminal("late-theme");
    await flushPromises();

    expect(attached).toHaveLength(1);
    expect(setThemeCalls).toHaveLength(0);

    setCustomThemes([washi()]);
    await nextTick();

    expect(setThemeCalls.at(-1)).toMatchObject({ background: WASHI_BG, foreground: WASHI_FG });
  });

  // The themes array is rebuilt on every config read, so an identity-only watch would repaint the
  // canvas of every terminal of every user on every load. Only a real colour change may.
  it("leaves the canvas alone when the arriving themes are not the selected one", async () => {
    serveDirConfig({});
    await mountTerminal("builtin-theme");
    await flushPromises();

    setCustomThemes([washi()]);
    await nextTick();

    expect(setThemeCalls).toHaveLength(0);
  });

  // A directory pinning a custom theme resolves through the same lookup, and was stranded the same
  // way — the pin arrives from /api/dir-config, the definition from /api/config, in either order.
  it("applies a custom theme a directory pins, whichever config lands first", async () => {
    serveDirConfig({ theme: "washi" });
    await mountTerminal("pinned-custom");
    await flushPromises();

    setCustomThemes([washi()]);
    await nextTick();

    expect(setThemeCalls.at(-1)).toMatchObject({ background: WASHI_BG, foreground: WASHI_FG });
  });
});

// #2097. Four scopes can name the same xterm colour and the whole feature is which one wins.
// The parts are unit-tested apart; this asserts the object the terminal is ACTUALLY handed, which
// is the only place the chain exists end to end.
describe("the xterm palette's precedence, end to end", () => {
  // The two seams are named separately on purpose. A helper that falls back from one to the other
  // lets a broken setTheme() pass on attach()'s correctness (Codex on this PR, iteration 2), so
  // each spec below says WHICH seam it means and the late-resolution case has its own test.
  const builtWith = () => attachedThemes.at(-1);
  const repaintedTo = () => setThemeCalls.at(-1);
  const CURSOR_FROM_TERM = "#b0402a";
  const ACCENT_FROM_TERM = "#fffdf8";
  const CURSOR_FROM_DIR = "#1188ff";

  it("lets the theme's term block beat what its variables imply", async () => {
    serveDirConfig({});
    setTheme("washi");
    setCustomThemes([{ ...washi(), term: { cursor: CURSOR_FROM_TERM, cursorAccent: ACCENT_FROM_TERM } }]);
    await mountTerminal("term-over-derived");
    await flushPromises();

    expect(builtWith()).toMatchObject({
      background: WASHI_BG,
      foreground: WASHI_FG,
      cursor: CURSOR_FROM_TERM,
      cursorAccent: ACCENT_FROM_TERM,
    });
    expect(setThemeCalls).toHaveLength(0); // it resolved before mount, so nothing repainted
  });

  // The narrowest scope wins, and it wins PER KEY: a directory naming only `cursor` must not take
  // `cursorAccent` with it, or one dir override silently reverts the other half of the pair.
  //
  // Asserted on the REPAINT, not on attach: /api/dir-config is fetched asynchronously, so the
  // terminal is genuinely built with the theme's own cursor and the directory's lands a tick
  // later. Naming the wrong seam here is what a fallback helper hid until Codex asked.
  it("lets a directory's colors beat the theme's term block, key by key", async () => {
    serveDirConfig({ colors: { cursor: CURSOR_FROM_DIR } });
    setTheme("washi");
    setCustomThemes([{ ...washi(), term: { cursor: CURSOR_FROM_TERM, cursorAccent: ACCENT_FROM_TERM } }]);
    await mountTerminal("dir-over-term");
    await flushPromises();

    expect(builtWith()).toMatchObject({ cursor: CURSOR_FROM_TERM });
    expect(repaintedTo()).toMatchObject({
      cursor: CURSOR_FROM_DIR,
      cursorAccent: ACCENT_FROM_TERM,
      background: WASHI_BG,
    });
  });

  // A value that is not a colour is dropped rather than passed on: xterm throws while parsing one,
  // and it throws during the assignment of the WHOLE theme, so one bad string costs every colour.
  it("drops a term entry that is not a colour, keeping the derived one", async () => {
    serveDirConfig({});
    setTheme("washi");
    setCustomThemes([{ ...washi(), term: { cursor: "red; background: url(x)" } }]);
    await mountTerminal("term-junk");
    await flushPromises();

    expect(builtWith()).toMatchObject({ cursor: WASHI_FG, cursorAccent: WASHI_BG });
  });

  // The OTHER seam. On a reload the selected id resolves to nothing until /api/config lands, so
  // the terminal is built on the default and the real palette arrives as a repaint — the path
  // #1943 was about. `term` has to survive that one too, and the three above cannot see it.
  it("carries the term block through a theme that resolves after mount", async () => {
    serveDirConfig({});
    setTheme("washi"); // selected while `themes` is still empty, exactly as a reload leaves it
    await mountTerminal("term-late");
    await flushPromises();
    expect(setThemeCalls).toHaveLength(0);

    setCustomThemes([{ ...washi(), term: { cursor: CURSOR_FROM_TERM, cursorAccent: ACCENT_FROM_TERM } }]);
    await nextTick();

    expect(repaintedTo()).toMatchObject({
      background: WASHI_BG,
      cursor: CURSOR_FROM_TERM,
      cursorAccent: ACCENT_FROM_TERM,
    });
  });
});
