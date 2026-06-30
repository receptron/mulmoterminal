import { describe, it, expect } from "vitest";
import { isClientRoute } from "./spa-fallback";

describe("SPA fallback matcher", () => {
  it("serves the SPA shell for client routes", () => {
    expect(isClientRoute("/")).toBe(true);
    expect(isClientRoute("/terminals")).toBe(true);
    expect(isClientRoute("/collections")).toBe(true);
    expect(isClientRoute("/collections/foo")).toBe(true);
    expect(isClientRoute("/feeds/tech-news")).toBe(true);
    expect(isClientRoute("/accounting")).toBe(true);
  });

  it("never shadows the /api prefix (incl. unknown api paths and the GUI MCP route)", () => {
    expect(isClientRoute("/api/sessions")).toBe(false);
    expect(isClientRoute("/api/mcp/abc-123")).toBe(false);
    expect(isClientRoute("/api/collections/foo/detail")).toBe(false);
    expect(isClientRoute("/api/this-route-does-not-exist")).toBe(false);
  });
});
