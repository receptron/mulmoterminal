// @vitest-environment node
import { describe, it, expect } from "vitest";
import { losslessText } from "../../../server/files/editableText.js";

// The editor destroys what it cannot represent, and it does so when it READS (#2038). These pin the
// exact property: do the bytes come back unchanged after a UTF-8 round trip.
describe("losslessText", () => {
  const bytes = (...b: number[]) => losslessText(Buffer.from(b));
  const text = (s: string) => losslessText(Buffer.from(s, "utf8"));

  it("returns the text for content that survives editing", () => {
    expect(text("hello\nworld\n")).toBe("hello\nworld\n");
    expect(text("\u3053\u3093\u306b\u3061\u306f")).toBe("\u3053\u3093\u306b\u3061\u306f");
    expect(text("a \u{1F389} b")).toBe("a \u{1F389} b"); // outside the BMP — a surrogate pair
    expect(losslessText(Buffer.alloc(0))).toBe("");
  });

  // A NUL byte is the usual "this is binary" sniff, and it is the WRONG question: this survives a
  // round trip exactly, so editing loses nothing and refusing it would be a false alarm.
  it("allows a NUL byte, which a binary sniff would refuse", () => {
    expect(bytes(0x61, 0x00, 0x62)).toBe("a\u0000b");
  });

  // A BOM is three bytes that encode U+FEFF; nothing is lost.
  it("allows a UTF-8 BOM", () => {
    expect(bytes(0xef, 0xbb, 0xbf, 0x78)).toBe("\uFEFFx");
  });

  it("refuses content the round trip would change", () => {
    expect(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff, 0xfe)).toBeNull(); // zip (xlsx)
    expect(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).toBeNull(); // PNG
    expect(bytes(0x63, 0x61, 0x66, 0xe9)).toBeNull(); // `cafe` with a Latin-1 accent
    expect(bytes(0xc3)).toBeNull(); // a truncated two-byte sequence
    expect(bytes(0xed, 0xa0, 0x80)).toBeNull(); // a lone surrogate, encoded
  });

  // The predicate answers "would editing destroy this", NOT "is this readable". UTF-16 text shows
  // as mojibake and still round-trips byte for byte, so it stays editable — deliberately, because
  // refusing it would be this function answering a question it was not asked.
  it("allows UTF-16 text, which is unreadable but not at risk", () => {
    expect(bytes(0x68, 0x00, 0x69, 0x00)).toBe("h\u0000i\u0000");
  });
});
