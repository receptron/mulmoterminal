// Prints, as one JSON line, every route mountAppRoutes mounts: `METHOD path`, the path as Express
// holds it (a RegExp route as its source). Run in its own process with a scratch HOME by
// remoteRouteCensus.spec.ts, because importing the server reads and creates files under HOME.
import express from "express";
import { isRecord } from "../../../../common/isRecord.js";
import { mountAppRoutes, type AppRouteDeps } from "../../../../server/routes/app-routes.js";
import { routeSignature } from "../../../../common/remoteRoutes.js";

// Mounting reads a few dependencies as values and calls none of them; the rest are only called by
// a request, and none is made here. So every key answers a callable stub, and the ones read as
// values answer what mountAppRoutes reads from them.
const callable = (): (() => undefined) => () => undefined;
const nested = (): Record<string, unknown> => new Proxy({}, { get: callable });
const VALUES: Record<string, () => unknown> = { agentAvailability: () => [], clientDir: () => "/nonexistent", outputBufferLimit: () => 1 };
const OBJECTS = new Set(["rateLimits", "toolStores", "toolSummaries"]);
const stubOf = (key: string): unknown => VALUES[key]?.() ?? (OBJECTS.has(key) ? nested() : callable());
const stubDeps: unknown = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? stubOf(key) : undefined) });
// Vouches for the stub above rather than checking it: no runtime test could tell it from the real deps.
const isAppRouteDeps = (value: unknown): value is AppRouteDeps => isRecord(value);

interface Layer {
  route?: { path: unknown; methods: Record<string, boolean> };
  handle?: unknown;
}
const isLayer = (value: unknown): value is Layer => isRecord(value);

// A package's own router (`app.use(router)`) holds its routes one level down. Its paths are listed
// as written, which is the path served only for a router mounted at the root; one mounted under a
// path shows up as a route nothing decides, so the census still fails rather than passing it.
const nestedStack = (handle: unknown): unknown => (isRecord(handle) || typeof handle === "function" ? Reflect.get(handle, "stack") : undefined);
const routesOf = (stack: unknown): string[] =>
  (Array.isArray(stack) ? stack : []).filter(isLayer).flatMap((layer) => {
    const route = layer.route;
    if (!route) return routesOf(nestedStack(layer.handle));
    const path = String(route.path);
    return Object.keys(route.methods).map((method) => routeSignature(method, path));
  });

const app = express();
if (!isAppRouteDeps(stubDeps)) throw new Error("the stub deps are not an object");
mountAppRoutes(app, stubDeps);
const routes = routesOf(app.router.stack);
process.stdout.write(`${JSON.stringify([...new Set(routes)])}\n`);
process.exit(0);
