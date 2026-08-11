// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  appendBoundedOutput,
  boundedTail,
  containsTerminalQuery,
  growOutputTail,
  stripTerminalQueries,
  terminalQueryPrefixTail,
  terminalModePrefix,
} from "../../../server/session/terminal-replay.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const TERMINAL_QUERIES = [
  `${ESC}[c`,
  `${ESC}[>0c`,
  `${ESC}[6n`,
  `${ESC}[?6n`,
  `${ESC}[?25n`,
  `${ESC}[?996n`,
  `${ESC}[?u`,
  `${ESC}[>0q`,
  `${ESC}]10;?${BEL}`,
  `${ESC}]10;?${ESC}\\`,
  `${ESC}]11;?${BEL}`,
  `${ESC}]11;?${ESC}\\`,
  `${ESC}]12;?${BEL}`,
  `${ESC}]12;?${ESC}\\`,
];

describe("stripTerminalQueries", () => {
  it("removes a Device Attributes query embedded in output (the 0;276;0c symptom source)", () => {
    expect(stripTerminalQueries(`abc${ESC}[>c def`)).toBe("abc def");
    expect(stripTerminalQueries(`${ESC}[c`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0c`)).toBe("");
  });

  it("removes device/cursor status queries", () => {
    expect(stripTerminalQueries(`${ESC}[6n`)).toBe("");
    expect(stripTerminalQueries(`x${ESC}[5ny`)).toBe("xy");
    expect(stripTerminalQueries(`${ESC}[?6n`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[?25n`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[?996n`)).toBe("");
  });

  it("removes kitty-keyboard and XTVERSION queries", () => {
    expect(stripTerminalQueries(`${ESC}[?u`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>q`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0q`)).toBe("");
  });

  it("removes OSC color queries (BEL- or ST-terminated)", () => {
    expect(stripTerminalQueries(`${ESC}]10;?${BEL}`)).toBe("");
    expect(stripTerminalQueries(`${ESC}]11;?${ESC}\\`)).toBe("");
  });

  it("does NOT strip a DA RESPONSE (multi-param) — only queries", () => {
    const response = `${ESC}[>0;276;0c`;
    expect(stripTerminalQueries(response)).toBe(response);
  });

  it("does NOT strip terminal status or cursor-position responses", () => {
    expect(stripTerminalQueries(`${ESC}[0n`)).toBe(`${ESC}[0n`);
    expect(stripTerminalQueries(`${ESC}[12;34R`)).toBe(`${ESC}[12;34R`);
  });

  it("leaves visible text and SGR colour sequences untouched", () => {
    const styled = `${ESC}[31mhello${ESC}[0m world`;
    expect(stripTerminalQueries(styled)).toBe(styled);
    expect(stripTerminalQueries("plain text")).toBe("plain text");
  });
});

describe("containsTerminalQuery", () => {
  it("recognises the terminal queries that xterm answers through onData", () => {
    for (const query of TERMINAL_QUERIES) {
      expect(containsTerminalQuery(`before${query}after`)).toBe(true);
    }
  });

  it("does not mistake terminal replies, styling or ordinary text for queries", () => {
    for (const output of [`${ESC}[?1;2c`, `${ESC}[0n`, `${ESC}[12;34R`, `${ESC}[31mred${ESC}[0m`, "plain text"])
      expect(containsTerminalQuery(output)).toBe(false);
  });
});

describe("terminalQueryPrefixTail", () => {
  it("keeps only a trailing fragment that can become a query", () => {
    expect(terminalQueryPrefixTail(`text${ESC}[`, 64)).toBe(`${ESC}[`);
    expect(terminalQueryPrefixTail(`text${ESC}[?99`, 64)).toBe(`${ESC}[?99`);
    expect(terminalQueryPrefixTail(`text${ESC}]10;?${ESC}`, 64)).toBe(`${ESC}]10;?${ESC}`);
  });

  it("drops completed and unrelated escape sequences", () => {
    expect(terminalQueryPrefixTail(`${ESC}[31m`, 64)).toBe("");
    expect(terminalQueryPrefixTail(`${ESC}[6n`, 64)).toBe("");
    expect(terminalQueryPrefixTail(`${ESC}[6n${ESC}[`, 64)).toBe(`${ESC}[`);
  });

  it("retains every possible split of every recognised query", () => {
    for (const query of TERMINAL_QUERIES) {
      for (let splitAt = 1; splitAt < query.length; splitAt++) {
        const prefix = query.slice(0, splitAt);
        expect(terminalQueryPrefixTail(prefix, 64), `${JSON.stringify(query)} at ${splitAt}`).toBe(prefix);
        expect(containsTerminalQuery(prefix + query.slice(splitAt))).toBe(true);
      }
    }
  });
});

describe("appendBoundedOutput", () => {
  it("appends verbatim while under the limit", () => {
    expect(appendBoundedOutput("abc", "def", 100)).toBe("abcdef");
    expect(appendBoundedOutput("", "", 100)).toBe("");
  });

  it("keeps the tail once the limit is exceeded", () => {
    // Exactly at the limit is still verbatim — only a genuine overflow trims.
    expect(appendBoundedOutput("abcde", "", 5)).toBe("abcde");
    expect(appendBoundedOutput("abc\ndef", "ghi", 6)).toBe("defghi");
  });

  // The #434 regression: a cut inside an SGR left "5;196m" rendering as literal text.
  // Worst case — the tail has no newline and no later ESC to resume from.
  it("drops a leading sequence remnant when there is no boundary to resume from", () => {
    const stream = "x".repeat(50) + `${ESC}[38;5;196m` + "RED";
    expect(appendBoundedOutput(stream, "", 9)).toBe("RED"); // was "5;196mRED"
  });

  // A clean cut must keep EVERY retained byte. An earlier version resumed at the next
  // newline or ESC, silently discarding the head of the tail even when nothing was split.
  it("keeps the whole tail when the cut falls between sequences", () => {
    expect(appendBoundedOutput("zzzhello world", "", 11)).toBe("hello world");
    expect(appendBoundedOutput("y".repeat(200), "", 10)).toBe("y".repeat(10));
    // Including a leading newline: it is a real byte of the retained tail, not a boundary
    // to skip past.
    expect(appendBoundedOutput(`aaa\nbbb${ESC}[0m`, "", 8)).toBe(`\nbbb${ESC}[0m`);
  });

  // Codex's counter-examples against the previous heuristic, which pattern-matched the
  // head of the tail and ate ordinary punctuation-then-letter prefixes.
  it.each([
    ["5 files pending", 15],
    ["/api/v1/resource", 16],
    ["3.14 is pi", 10],
    [";not a sequence", 15],
  ])("does not touch plain text that merely looks like a sequence: %s", (text, limit) => {
    expect(appendBoundedOutput(`${"q".repeat(40)}${text}`, "", limit)).toBe(text);
  });

  it("drops only the split sequence, keeping the text that follows it", () => {
    // The cut lands inside the SGR; "RED" after it must survive intact.
    const stream = `${"x".repeat(50)}${ESC}[38;5;196mRED`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("RED");
  });

  it("drops the introducer too when only the ESC was discarded", () => {
    const stream = `${"x".repeat(50)}${ESC}[31mbbb`;
    expect(appendBoundedOutput(stream, "", 7)).toBe("bbb");
  });

  it("keeps a sequence that closed before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}[31mvisible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  // An OSC string ends with BEL, not a CSI final byte, so scanning for 0x40-0x7E would
  // stop inside the title and leave half of it on screen.
  it("drops a split OSC string up to its BEL terminator", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;window title${BEL}after`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("after");
  });

  // ST is the two bytes `ESC \`. Consuming only the ESC leaks a stray backslash.
  it("drops a split OSC string up to its ST terminator, backslash included", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;window title${ESC}\\after`;
    const out = appendBoundedOutput(stream, "", 12);
    expect(out.startsWith("\\")).toBe(false);
    expect(out).toBe("after");
  });

  it("keeps an OSC string that closed with ST before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}]0;title${ESC}\\visible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  // OSC 52 carries the clipboard as base64 and this host enables it deliberately
  // (infra/tmux.ts forwards Claude Code's auto-copy), so payloads run to kilobytes.
  // Any fixed look-behind window loses the introducer and leaks base64 onto the screen.
  it("finds the introducer of an OSC payload far longer than any fixed window", () => {
    const payload = "QUJDRA".repeat(500);
    const stream = `${"x".repeat(50)}${ESC}]52;c;${payload}${BEL}after`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("after");
  });

  it("keeps a long OSC payload that closed before the cut", () => {
    const stream = `${"x".repeat(50)}${ESC}]52;c;${"QUJDRA".repeat(500)}${BEL}visible text`;
    expect(appendBoundedOutput(stream, "", 12)).toBe("visible text");
  });

  it("drops a split two-character sequence", () => {
    const stream = `${"x".repeat(50)}${ESC}Mrest`;
    expect(appendBoundedOutput(stream, "", 5)).toBe("rest");
  });

  it("stays within the limit", () => {
    const stream = `${"z".repeat(500)}\n${"w".repeat(500)}`;
    expect(appendBoundedOutput(stream, "more", 64).length).toBeLessThanOrEqual(64);
  });
});

describe("terminalModePrefix", () => {
  it("re-establishes each mode the reattaching browser lost", () => {
    expect(terminalModePrefix([1049, 1003, 1006])).toBe(`${ESC}[?1049h${ESC}[?1003h${ESC}[?1006h`);
  });

  it("sends nothing when the pane has nothing sticky to restore", () => {
    expect(terminalModePrefix([])).toBe("");
  });

  // A combined `CSI ? 1049 ; 1003 h` is NOT all mouse modes, so the client would let it through to
  // xterm — which would then track the mouse itself and turn every drag into coordinate reports
  // instead of a text selection (#729). One sequence per mode is what keeps the swallow working.
  it("never combines modes into one parameter list", () => {
    expect(terminalModePrefix([1049, 1003, 1006])).not.toContain(";");
  });
});

describe("growOutputTail", () => {
  it("appends without cutting while inside the slack", () => {
    expect(growOutputTail("abc", "def", 100)).toBe("abcdef");
    // 1.25x of 10 is 12.5, so 12 characters still ride along uncut.
    expect(growOutputTail("a".repeat(11), "b", 10)).toBe("a".repeat(11) + "b");
  });

  it("cuts back to the limit once the slack is exceeded", () => {
    const grown = growOutputTail("a".repeat(20), "b".repeat(20), 10);
    expect(grown).toBe("b".repeat(10));
  });

  it("leaves the reader something to bound, never something already bounded", () => {
    let buffer = "";
    for (let i = 0; i < 500; i++) buffer = growOutputTail(buffer, "0123456789", 100);
    expect(buffer.length).toBeGreaterThan(100); // the overrun is the point (PtyEntry.buffer)
    expect(buffer.length).toBeLessThanOrEqual(125);
    expect(boundedTail(buffer, 100)).toHaveLength(100);
  });
});

// The whole fix rests on one claim: deferring the cut does not change what a reattaching
// browser is sent. Pin it by running both schemes over the same stream and comparing —
// not by re-deriving what the tail "should" be, which would just restate the new code.
describe("growOutputTail + boundedTail vs. appendBoundedOutput", () => {
  // A deterministic pseudo-random stream of the things a real pty emits, re-cut at
  // arbitrary chunk boundaries so sequences straddle them.
  function stream(seed: number, maxOscUnits: number) {
    let state = seed;
    const rnd = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    const atoms = [
      () => "text".repeat(1 + Math.floor(rnd() * 20)),
      () => "\r\n",
      () => `${ESC}[${Math.floor(rnd() * 200)}m`,
      () => `${ESC}[${Math.floor(rnd() * 50)};${Math.floor(rnd() * 50)}H`,
      () => `${ESC}]0;a title${BEL}`,
      () => `${ESC}]52;c;${"QUJD".repeat(1 + Math.floor(rnd() * maxOscUnits))}${BEL}`, // OSC 52 clipboard
      () => `${ESC}]8;;https://example.com/${"p".repeat(Math.floor(rnd() * 300))}${ESC}\\`,
      () => `${ESC}=`,
      () => `${ESC}(B`,
      () => ESC, // an aborted escape
      () => "日本語テキストの行です\r\n",
    ];
    const parts: string[] = [];
    let length = 0;
    while (length < 40000) {
      const atom = atoms[Math.floor(rnd() * atoms.length)]();
      parts.push(atom);
      length += atom.length;
    }
    const whole = parts.join("");
    const chunks: string[] = [];
    for (let at = 0; at < whole.length;) {
      const size = 1 + Math.floor(rnd() * 200);
      chunks.push(whole.slice(at, at + size));
      at += size;
    }
    return chunks;
  }

  const bothWays = (chunks: readonly string[], limit: number) => {
    let eager = "";
    let deferred = "";
    for (const chunk of chunks) {
      eager = appendBoundedOutput(eager, chunk, limit);
      deferred = growOutputTail(deferred, chunk, limit);
    }
    return { eager, deferred: boundedTail(deferred, limit) };
  };

  it("replays byte-for-byte the same tail when no single sequence outgrows the limit", () => {
    for (let seed = 1; seed <= 25; seed++) {
      // Sequences top out near 3.2k here; every limit is far above that, as 1 MiB is in production.
      const limit = 16384 + seed * 997;
      const { eager, deferred } = bothWays(stream(seed, 800), limit);
      expect(deferred).toBe(eager);
    }
  });

  // When a sequence IS longer than the whole buffer, the deferred cut sees more of the
  // discarded side and recognises an orphan the eager one had already lost track of. It
  // therefore drops MORE — but only ever from the front, and only bytes belonging to that
  // unterminated sequence, which would have drawn as literal base64 at the top of the screen.
  it("drops only orphaned sequence bytes, never visible text, when one outgrows the limit", () => {
    // Built rather than written literally, so the ESC stays out of the regex source — the same
    // reason terminal-replay.ts builds its patterns that way.
    const lineOrSequence = new RegExp(`[\\r\\n${ESC}]`);
    let diverged = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const limit = 200 + seed * 37;
      const { eager, deferred } = bothWays(stream(seed, 800), limit);
      if (deferred === eager) continue;
      diverged++;
      expect(eager.endsWith(deferred)).toBe(true); // a suffix: nothing removed from the end
      const dropped = eager.slice(0, eager.length - deferred.length);
      expect(dropped).not.toMatch(lineOrSequence); // no line, no new sequence — orphan payload only
    }
    expect(diverged).toBeGreaterThan(0); // the case is actually being exercised
  });
});
