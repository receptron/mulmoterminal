import { describe, it, expect } from "vitest";
import { deriveFaviconState } from "../../../src/composables/useFaviconState";

const a = (working: boolean, waiting: boolean) => ({ working, waiting });

describe("deriveFaviconState", () => {
  it("is idle for no sessions", () => {
    expect(deriveFaviconState([])).toBe("idle");
  });

  it("is idle when every session is quiet", () => {
    expect(deriveFaviconState([a(false, false), a(false, false)])).toBe("idle");
  });

  it("is working when any session is working (and none waiting)", () => {
    expect(deriveFaviconState([a(false, false), a(true, false)])).toBe("working");
  });

  it("is attention when any session is waiting", () => {
    expect(deriveFaviconState([a(false, false), a(false, true)])).toBe("attention");
  });

  it("prioritizes attention over working", () => {
    expect(deriveFaviconState([a(true, false), a(false, true)])).toBe("attention");
    expect(deriveFaviconState([a(true, true)])).toBe("attention");
  });
});
