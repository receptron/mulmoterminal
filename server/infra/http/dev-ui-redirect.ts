import type { Express, NextFunction, Request, Response } from "express";

export interface DevUiRedirectInput {
  enabled: boolean;
  method: string;
  pathname: string;
  acceptsHtml: boolean;
  protocol: string;
  hostname: string;
  originalUrl: string;
  clientPort: number;
}

/** Return the Vite URL for a browser navigation that must leave the backend. */
export function devUiRedirectLocation(input: DevUiRedirectInput): string | null {
  const isApiPath = input.pathname === "/api" || input.pathname.startsWith("/api/");
  if (!input.enabled || input.method !== "GET" || !input.acceptsHtml || isApiPath) return null;
  return `${input.protocol}://${input.hostname}:${input.clientPort}${input.originalUrl}`;
}

export function mountDevUiRedirect(app: Pick<Express, "use">, clientPort: number): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const location = devUiRedirectLocation({
      enabled: true,
      method: req.method,
      pathname: req.path,
      acceptsHtml: req.accepts("html") === "html",
      protocol: req.protocol,
      hostname: req.hostname,
      originalUrl: req.originalUrl,
      clientPort,
    });
    if (location) res.redirect(location);
    else next();
  });
}
