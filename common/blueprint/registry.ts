// A registry: a JSON file somewhere on the web listing packs and where each one's files are — a git
// repository, a branch or tag, and a directory inside it. Installing takes only what a registry
// lists; nothing installs from a repository a caller names directly.
import { z } from "zod";
import { BLUEPRINT_SLUG_RE } from "./manifest.js";
import { isContainedRelativePath } from "./relativePath.js";

// Branch and tag names only (a clone is `--branch`, which a bare commit id is not).
const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
// One directory name inside the repository.
const REPO_PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Where a pack may be cloned from: https, or a repository on this machine. */
export const isAllowedRepo = (repo: string): boolean => /^https:\/\/[^\s]+$/.test(repo) || /^file:\/\/\/[^\s]+$/.test(repo);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Where a registry may be read from: https, or plain http on this machine only. */
export function isAllowedRegistryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname));
  } catch {
    return false;
  }
}

/** A registry on the web may point only at the web: a file:/// repository is this machine's own
 *  disk, and only a registry that is itself on this machine may name one. */
export function repoAllowedFor(registryUrl: string, repo: string): boolean {
  if (!repo.startsWith("file://")) return true;
  try {
    const registry = new URL(registryUrl);
    return registry.protocol === "http:" && LOOPBACK_HOSTS.has(registry.hostname);
  } catch {
    return false;
  }
}

export const registryEntrySchema = z.object({
  slug: z.string().regex(BLUEPRINT_SLUG_RE),
  kind: z.enum(["base", "usecase"]),
  title: z.string().min(1),
  description: z.string().default(""),
  repo: z.string().refine(isAllowedRepo, "repo must be an https:// or file:/// git URL"),
  ref: z.string().regex(GIT_REF_RE).default("main"),
  // The pack's directory inside the repository; empty means the repository root.
  path: z
    .union([z.literal(""), z.string().refine((value) => isContainedRelativePath(value, REPO_PATH_SEGMENT_RE), "path must stay inside the repository")])
    .default(""),
});

export const registrySchema = z.object({ name: z.string().default(""), packs: z.array(registryEntrySchema) });

export const registriesFileSchema = z.object({ urls: z.array(z.string().refine(isAllowedRegistryUrl, "registry URLs must be https (or http on localhost)")) });

/** Written beside an installed pack: where it came from, so an update can say what changed. */
export const installRecordSchema = z.object({
  slug: z.string(),
  registryUrl: z.string(),
  repo: z.string(),
  ref: z.string(),
  commit: z.string(),
  installedAtMs: z.number(),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;
export type Registry = z.infer<typeof registrySchema>;
export type InstallRecord = z.infer<typeof installRecordSchema>;

/** One registry as the market shows it: its packs, each with what is installed of it. */
export const catalogSchema = z.object({
  registries: z.array(
    z.object({
      url: z.string(),
      name: z.string(),
      error: z.string().nullable(),
      packs: z.array(registryEntrySchema.extend({ builtin: z.boolean(), installed: installRecordSchema.nullable() })),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;
