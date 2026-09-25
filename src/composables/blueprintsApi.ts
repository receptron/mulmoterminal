// The blueprint overlay's calls to /api/blueprints. Every body is parsed with the same schemas the
// server writes with, so a shape that drifted shows up as an error on screen, not as `undefined`.
import { z } from "zod";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { jsonBody } from "../jsonBody";
import { blueprintManifestSchema } from "../../common/blueprint/manifest";
import { hearingSchema, type HearingAnswers } from "../../common/blueprint/hearing";
import { planStepSchema } from "../../common/blueprint/plan";
import { blueprintRunSchema, blueprintRunSummarySchema, blueprintRunViewSchema, type BlueprintRunView } from "../../common/blueprint/run";
import { presetListingSchema, type PresetListing } from "../../common/blueprint/presets";
import { catalogSchema, installRecordSchema, type Catalog, type InstallRecord } from "../../common/blueprint/registry";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

const packsSchema = z.object({ packs: z.array(z.object({ slug: z.string(), manifest: blueprintManifestSchema })) });
const pairSchema = z.object({ hearing: hearingSchema, steps: z.array(planStepSchema.extend({ origin: z.enum(["base", "usecase"]) })) });
const runsSchema = z.object({ runs: z.array(blueprintRunSummarySchema) });
const presetsSchema = z.object({ presets: z.array(presetListingSchema) });
const createdSchema = z.object({ runId: z.string() });

export type PackList = z.infer<typeof packsSchema>["packs"];
export type PairPreview = z.infer<typeof pairSchema>;
export type RunList = z.infer<typeof runsSchema>["runs"];

async function call<T>(schema: z.ZodType<T>, url: string, init?: RequestInit, timeout_ms?: number): Promise<ApiResult<T>> {
  try {
    const res = await fetchWithTimeout(url, init, timeout_ms);
    const body = await jsonBody(res);
    if (!res.ok) return { ok: false, error: typeof body.error === "string" ? body.error : `HTTP ${res.status} from ${url}` };
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: `Unexpected answer from ${url}` };
  } catch (err) {
    return { ok: false, error: `${url}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const postJson = (payload: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

export const listPacks = (): Promise<ApiResult<z.infer<typeof packsSchema>>> => call(packsSchema, "/api/blueprints/packs");

export const previewPair = (base: string, usecase: string): Promise<ApiResult<PairPreview>> =>
  call(pairSchema, `/api/blueprints/pairs/${encodeURIComponent(base)}/${encodeURIComponent(usecase)}`);

export const listPresets = (): Promise<ApiResult<{ presets: PresetListing[] }>> => call(presetsSchema, "/api/blueprints/presets");

export const listRuns = (): Promise<ApiResult<z.infer<typeof runsSchema>>> => call(runsSchema, "/api/blueprints/runs");

export const loadRun = (runId: string): Promise<ApiResult<BlueprintRunView>> =>
  call(blueprintRunViewSchema, `/api/blueprints/runs/${encodeURIComponent(runId)}`);

export const startRun = (request: { projectDir: string; base: string; usecase: string; answers: HearingAnswers }): Promise<ApiResult<{ runId: string }>> =>
  call(createdSchema, "/api/blueprints/runs", postJson(request));

export type PersonEvent = { type: "approve" } | { type: "reject"; reason: string } | { type: "answer"; answer: string } | { type: "retry" };

export const sendEvent = (runId: string, stepId: string, event: PersonEvent): Promise<ApiResult<BlueprintRunView>> =>
  call(blueprintRunViewSchema, `/api/blueprints/runs/${encodeURIComponent(runId)}/events`, postJson({ ...event, stepId }));

const urlsSchema = z.object({ urls: z.array(z.string()) });

export const loadCatalog = (): Promise<ApiResult<Catalog>> => call(catalogSchema, "/api/blueprints/market/catalog");

export const loadRegistryUrls = (): Promise<ApiResult<{ urls: string[] }>> => call(urlsSchema, "/api/blueprints/market/registries");

export const saveRegistryUrls = (urls: readonly string[]): Promise<ApiResult<{ urls: string[] }>> =>
  call(urlsSchema, "/api/blueprints/market/registries", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ urls }) });

// A clone over the network can take far longer than an ordinary request.
const INSTALL_TIMEOUT_MS = 180_000;

export const installPack = (registryUrl: string, slug: string): Promise<ApiResult<{ installed: InstallRecord }>> =>
  call(z.object({ installed: installRecordSchema }), "/api/blueprints/market/install", postJson({ registryUrl, slug }), INSTALL_TIMEOUT_MS);

export const uninstallPack = (slug: string): Promise<ApiResult<{ ok: boolean }>> =>
  call(z.object({ ok: z.boolean() }), "/api/blueprints/market/uninstall", postJson({ slug }));

const specViewSchema = z.object({
  spec: z.string().nullable(),
  openQuestions: z.string().nullable(),
  chat: blueprintRunSchema.shape.specChat,
  revising: z.boolean(),
});
export type SpecView = z.infer<typeof specViewSchema>;

export const loadSpec = (runId: string): Promise<ApiResult<SpecView>> => call(specViewSchema, `/api/blueprints/runs/${encodeURIComponent(runId)}/spec`);

export const sendSpecMessage = (runId: string, message: string): Promise<ApiResult<BlueprintRunView>> =>
  call(blueprintRunViewSchema, `/api/blueprints/runs/${encodeURIComponent(runId)}/spec/messages`, postJson({ message }));
