// /api/blueprints/market — which registries this machine reads, what they list, and installing or
// removing a listed pack. An install names a registry this machine already reads and a slug in it;
// the repository comes from the registry, never from the request.
import type { Express, Response } from "express";
import { z } from "zod";
import { listPacks, type PackRoot } from "./packs.js";
import { fetchRegistry, loadCatalog, readRegistryUrls, writeRegistryUrls, type FetchText } from "./registry.js";
import { InstallRefusal, installPack, installedRecord, uninstallPack, type CloneRepo } from "./installer.js";
import { BLUEPRINT_SLUG_RE } from "../../common/blueprint/manifest.js";
import { isAllowedRegistryUrl } from "../../common/blueprint/registry.js";

export interface MarketRouteDeps {
  builtinRoot: PackRoot;
  packsDir: string;
  registriesFile: string;
  clone: CloneRepo;
  fetchImpl?: FetchText | undefined;
  now: () => number;
}

const urlsSchema = z.object({ urls: z.array(z.string()) });
const installSchema = z.object({ registryUrl: z.string(), slug: z.string().regex(BLUEPRINT_SLUG_RE) });

const builtinSlugs = async (deps: MarketRouteDeps): Promise<Set<string>> => new Set((await listPacks([deps.builtinRoot])).map((pack) => pack.slug));

function fail(res: Response, err: unknown): void {
  const status = err instanceof InstallRefusal ? 409 : 502;
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

function mountRegistryListRoutes(app: Express, deps: MarketRouteDeps): void {
  app.get("/api/blueprints/market/registries", async (_req, res) => {
    res.json({ urls: await readRegistryUrls(deps.registriesFile) });
  });

  app.put("/api/blueprints/market/registries", async (req, res) => {
    const parsed = urlsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "expected { urls: string[] }" });
    const refused = parsed.data.urls.filter((url) => !isAllowedRegistryUrl(url));
    if (refused.length > 0) return res.status(400).json({ error: `registry URLs must be https (or http on localhost): ${refused.join(", ")}` });
    await writeRegistryUrls(deps.registriesFile, parsed.data.urls);
    return res.json({ urls: await readRegistryUrls(deps.registriesFile) });
  });
}

function mountCatalogRoute(app: Express, deps: MarketRouteDeps): void {
  app.get("/api/blueprints/market/catalog", async (_req, res) => {
    const urls = await readRegistryUrls(deps.registriesFile);
    res.json(
      await loadCatalog({ urls, builtinSlugs: await builtinSlugs(deps), installed: (slug) => installedRecord(deps.packsDir, slug), fetchImpl: deps.fetchImpl }),
    );
  });
}

// Installs and removals in flight, by slug: two at once for one pack would swap over each other.
const busySlugs = new Set<string>();

async function exclusively<T>(slug: string, work: () => Promise<T>): Promise<T> {
  if (busySlugs.has(slug)) throw new InstallRefusal(`"${slug}" is already being installed or removed`);
  busySlugs.add(slug);
  try {
    return await work();
  } finally {
    busySlugs.delete(slug);
  }
}

function mountInstallRoutes(app: Express, deps: MarketRouteDeps): void {
  app.post("/api/blueprints/market/install", async (req, res) => {
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "expected { registryUrl, slug }" });
    const { registryUrl, slug } = parsed.data;
    if (!(await readRegistryUrls(deps.registriesFile)).includes(registryUrl))
      return res.status(400).json({ error: `not a registry this machine reads: ${registryUrl}` });
    try {
      const entry = (await fetchRegistry(registryUrl, deps.fetchImpl)).packs.find((pack) => pack.slug === slug);
      if (!entry) return res.status(404).json({ error: `${registryUrl} lists no pack "${slug}"` });
      const shipped = await builtinSlugs(deps);
      const record = await exclusively(slug, () =>
        installPack(entry, registryUrl, { packsDir: deps.packsDir, builtinSlugs: shipped, clone: deps.clone, now: deps.now }),
      );
      return res.json({ installed: record });
    } catch (err) {
      return fail(res, err);
    }
  });

  app.post("/api/blueprints/market/uninstall", async (req, res) => {
    const parsed = z.object({ slug: z.string().regex(BLUEPRINT_SLUG_RE) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "expected { slug }" });
    try {
      const removed = await exclusively(parsed.data.slug, () => uninstallPack(deps.packsDir, parsed.data.slug));
      return removed ? res.json({ ok: true }) : res.status(404).json({ error: `"${parsed.data.slug}" is not an installed pack` });
    } catch (err) {
      return fail(res, err);
    }
  });
}

export function mountMarketRoutes(app: Express, deps: MarketRouteDeps): void {
  mountRegistryListRoutes(app, deps);
  mountCatalogRoute(app, deps);
  mountInstallRoutes(app, deps);
}
