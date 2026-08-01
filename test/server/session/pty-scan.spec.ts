// @vitest-environment node
// squashForMarker, against bytes captured from a real `claude` pty (v2.1.220). The captures
// matter more than the unit cases: the whole reason the readiness marker sat dead was that
// hand-written test strings looked nothing like what a terminal sends.
import { describe, it, expect } from "vitest";

import { squashForMarker } from "../../../server/session/pty-scan.js";

const ESC = "\u001b";
const BEL = "\u0007";

describe("squashForMarker", () => {
  it("drops the cursor moves a redraw puts between words", () => {
    expect(squashForMarker(`?${ESC}[24Gfor${ESC}[28Gshortcuts`)).toBe("?forshortcuts");
  });

  // The same words with no escapes at all squash identically — which is what lets one marker
  // serve both a real stream and a plain-text fixture.
  it("squashes plain text to the same form", () => {
    expect(squashForMarker("? for shortcuts")).toBe("?forshortcuts");
    expect(squashForMarker("⏸ manual mode on · ? for shortcuts")).toBe("⏸manualmodeon·?forshortcuts");
  });

  it("drops SGR colour, OSC 8 hyperlinks and the DEC private modes a TUI turns on", () => {
    expect(squashForMarker(`${ESC}[38;2;153;153;153m⏸${ESC}[39m manual`)).toBe("⏸manual");
    expect(squashForMarker(`${ESC}]8;id=zaxmda;https://code.claude.com/docs${BEL}Security guide${ESC}]8;;${BEL}`)).toBe("securityguide");
    expect(squashForMarker(`${ESC}[?2004h${ESC}[>4;2m${ESC}[<u ready`)).toBe("ready");
  });

  // Claude draws its empty input box as "❯" + U+00A0, which a plain trim would keep.
  it("drops non-breaking space along with the rest of the whitespace", () => {
    expect(squashForMarker("❯\u00a0 \r\n\tTry")).toBe("❯try");
  });

  it("lowercases, so a marker can be written in one case", () => {
    expect(squashForMarker("Yes, I trust this folder")).toBe("yes,itrustthisfolder");
  });

  // Verbatim from a `claude` spawn in a directory it had not seen. Every word is separated by a
  // column move, which is exactly what the old spaced regex could not match.
  it("recognizes the trust dialog as it actually arrives", () => {
    const captured = `${ESC}[2GIs${ESC}[25Gthis${ESC}[30Ga${ESC}[32Gproject${ESC}[40Gyou${ESC}[44Gcreated${ESC}[52Gor${ESC}[55Gone${ESC}[59Gyou${ESC}[63Gtrust?`;
    expect(squashForMarker(captured)).toContain("projectyoucreatedoroneyoutrust");
  });
});
