// @vitest-environment node
// The helper's own contract. The 13 route specs that use it cover the ordinary cases by
// existing; what is pinned here is the translation layer between `inject`'s answer and the
// `Response` those specs read — the two places it does something other than pass a value on.
import { describe, it, expect } from "vitest";
import express from "express";
import { appRequest } from "./appRequest.js";

describe("appRequest", () => {
  const app = express();
  app.use(express.json());
  app.get("/echo", (req, res) => res.json({ method: req.method, query: req.query, agent: req.get("user-agent") ?? null }));
  app.post("/echo", (req, res) => res.status(201).json(req.body));
  app.get("/empty", (_req, res) => res.status(204).end());
  app.get("/unchanged", (_req, res) => res.status(304).end());
  app.get("/bytes", (_req, res) => res.type("image/png").send(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  app.get("/two-cookies", (_req, res) => {
    res.append("set-cookie", "a=1");
    res.append("set-cookie", "b=2");
    res.end("ok");
  });

  const request = appRequest(app);

  it("carries the method, query and request headers through to the route", async () => {
    const res = await request("/echo?slug=alpha&n=2", { headers: { "user-agent": "spec" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "GET", query: { slug: "alpha", n: "2" }, agent: "spec" });
  });

  it("sends a body the route parses, and reports the status the route chose", async () => {
    const res = await request("/echo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hi: true }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ hi: true });
  });

  // These statuses forbid a body, and `new Response(<anything>, { status: 204 })` THROWS rather
  // than failing an assertion — which would read as a broken helper, not a route answering 204.
  it.each([
    ["/empty", 204],
    ["/unchanged", 304],
  ])("answers %s, a no-body status, without constructing a body", async (url, status) => {
    const res = await request(url);
    expect(res.status).toBe(status);
    expect(await res.text()).toBe("");
  });

  it("keeps bytes as bytes", async () => {
    const res = await request("/bytes");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  // `inject` reports a repeated header as a list. Setting instead of appending would keep only
  // the last one, so a route that sends two cookies would look like it sent one.
  it("keeps every value of a header the response repeated", async () => {
    const res = await request("/two-cookies");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("reports a route that is not mounted as the 404 it is", async () => {
    expect((await request("/nope")).status).toBe(404);
  });
});
