// @vitest-environment node
import { describe, expect, it } from "vitest";
import { devUiRedirectLocation } from "../../../../server/infra/http/dev-ui-redirect";

const input = (overrides: Partial<Parameters<typeof devUiRedirectLocation>[0]> = {}) => ({
  enabled: true,
  method: "GET",
  pathname: "/github/board",
  acceptsHtml: true,
  protocol: "http",
  hostname: "localhost",
  originalUrl: "/github/board?tab=open",
  clientPort: 6856,
  ...overrides,
});

describe("dev UI redirect", () => {
  it("redirects browser routes to Vite when enabled", () => {
    expect(devUiRedirectLocation(input())).toBe("http://localhost:6856/github/board?tab=open");
    expect(devUiRedirectLocation(input({ hostname: "::1" }))).toBe("http://[::1]:6856/github/board?tab=open");
  });

  it("keeps production and backend requests on the backend", () => {
    expect(devUiRedirectLocation(input({ enabled: false }))).toBeNull();
    expect(devUiRedirectLocation(input({ pathname: "/api/sessions", originalUrl: "/api/sessions" }))).toBeNull();
    expect(devUiRedirectLocation(input({ pathname: "/apidocs" }))).not.toBeNull();
    expect(devUiRedirectLocation(input({ method: "POST" }))).toBeNull();
    expect(devUiRedirectLocation(input({ acceptsHtml: false }))).toBeNull();
  });
});
