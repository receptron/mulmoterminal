// Reading registries, and the list of which registries this machine reads.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../files/atomic-write.js";
import { registriesFileSchema, registrySchema, type Catalog, type InstallRecord, type Registry } from "../../common/blueprint/registry.js";

// A registry is one small JSON file; one that takes longer than this is not answering.
export const REGISTRY_TIMEOUT_MS = 15_000;

export type FetchText = (url: string, signal: AbortSignal) => Promise<string>;

export const fetchText: FetchText = async (url, signal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

export async function fetchRegistry(url: string, fetchImpl: FetchText = fetchText): Promise<Registry> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REGISTRY_TIMEOUT_MS);
  try {
    return registrySchema.parse(JSON.parse(await fetchImpl(url, abort.signal)));
  } catch (err) {
    throw new Error(`registry ${url}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function readRegistryUrls(file: string): Promise<string[]> {
  try {
    return registriesFileSchema.parse(JSON.parse(await readFile(file, "utf8"))).urls;
  } catch {
    return [];
  }
}

export async function writeRegistryUrls(file: string, urls: readonly string[]): Promise<void> {
  const unique = [...new Set(urls)];
  registriesFileSchema.parse({ urls: unique });
  await writeFileAtomic(file, `${JSON.stringify({ urls: unique }, null, 2)}\n`);
}

export interface CatalogDeps {
  urls: readonly string[];
  builtinSlugs: ReadonlySet<string>;
  installed: (slug: string) => Promise<InstallRecord | null>;
  fetchImpl?: FetchText | undefined;
}

async function catalogEntry(url: string, deps: CatalogDeps): Promise<Catalog["registries"][number]> {
  try {
    const registry = await fetchRegistry(url, deps.fetchImpl);
    const packs = await Promise.all(
      registry.packs.map(async (entry) => ({ ...entry, builtin: deps.builtinSlugs.has(entry.slug), installed: await deps.installed(entry.slug) })),
    );
    return { url, name: registry.name || url, error: null, packs };
  } catch (err) {
    return { url, name: url, error: err instanceof Error ? err.message : String(err), packs: [] };
  }
}

/** Every configured registry with its packs; one that cannot be read says why instead of failing all. */
export async function loadCatalog(deps: CatalogDeps): Promise<Catalog> {
  return { registries: await Promise.all(deps.urls.map((url) => catalogEntry(url, deps))) };
}

export const registriesFile = (home: string): string => path.join(home, "blueprints", "registries.json");
