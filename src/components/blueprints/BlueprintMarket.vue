<script setup lang="ts">
// The market: which registries this machine reads, and the packs they list. Installing runs a
// pack's scripts as the user from then on, so it is confirmed with the repository named — the one
// thing a person needs to decide whether they trust it.
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { installPack, loadCatalog, loadRegistryUrls, saveRegistryUrls, uninstallPack, type ApiResult } from "../../composables/blueprintsApi";
import type { Catalog } from "../../../common/blueprint/registry";

const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

// Enough of a commit id to tell two installs apart at a glance.
const SHORT_COMMIT_CHARS = 7;

type CatalogPack = Catalog["registries"][number]["packs"][number];

const catalog = ref<Catalog>({ registries: [] });
const urls = ref<string[]>([]);
const newUrl = ref("");
const busy = ref<string | null>(null);
const error = ref<string | null>(null);

const hasRegistries = computed(() => urls.value.length > 0);

async function refresh(): Promise<void> {
  const [listed, read] = await Promise.all([loadRegistryUrls(), loadCatalog()]);
  if (listed.ok) urls.value = listed.value.urls;
  if (read.ok) catalog.value = read.value;
  error.value = firstError(listed, read);
}

onMounted(() => void refresh());

async function saveUrls(next: string[]): Promise<void> {
  const result = await saveRegistryUrls(next);
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  newUrl.value = "";
  await refresh();
}

const addRegistry = (): Promise<void> => saveUrls([...urls.value, newUrl.value.trim()]);
const removeRegistry = (url: string): Promise<void> => saveUrls(urls.value.filter((entry) => entry !== url));

async function install(registryUrl: string, pack: CatalogPack): Promise<void> {
  if (!window.confirm(t("blueprints.market.confirmInstall", { title: pack.title, repo: pack.repo, ref: pack.ref }))) return;
  busy.value = pack.slug;
  const result = await installPack(registryUrl, pack.slug);
  busy.value = null;
  error.value = result.ok ? null : result.error;
  await refresh();
  if (result.ok) emit("changed");
}

async function uninstall(pack: CatalogPack): Promise<void> {
  if (!window.confirm(t("blueprints.market.confirmUninstall", { title: pack.title }))) return;
  busy.value = pack.slug;
  const result = await uninstallPack(pack.slug);
  busy.value = null;
  error.value = result.ok ? null : result.error;
  await refresh();
  if (result.ok) emit("changed");
}

const shortCommit = (commit: string): string => commit.slice(0, SHORT_COMMIT_CHARS);

function firstError(...results: ApiResult<unknown>[]): string | null {
  const failed = results.find((result): result is Extract<ApiResult<unknown>, { ok: false }> => !result.ok);
  return failed ? failed.error : null;
}
</script>

<template>
  <div class="flex max-w-[860px] flex-col gap-5 p-5" data-testid="blueprint-market">
    <div class="flex flex-col gap-1">
      <h2 class="m-0 font-sans text-[16px] font-[650] text-fg">{{ t("blueprints.market.title") }}</h2>
      <p class="m-0 font-sans text-[12px] text-secondary">{{ t("blueprints.market.intro") }}</p>
    </div>

    <section class="flex flex-col gap-2">
      <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.market.registries") }}</h3>
      <p v-if="!hasRegistries" class="m-0 font-sans text-[12px] text-dim">{{ t("blueprints.market.noRegistries") }}</p>
      <div v-for="url in urls" :key="url" class="flex items-center gap-2" data-testid="blueprint-registry">
        <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-secondary">{{ url }}</span>
        <button
          type="button"
          class="cursor-pointer rounded-[4px] border border-border bg-base px-2 py-1 font-sans text-[12px] text-secondary hover:bg-hover"
          @click="removeRegistry(url)"
        >
          {{ t("blueprints.market.removeRegistry") }}
        </button>
      </div>
      <form class="flex gap-2" @submit.prevent="addRegistry">
        <input
          v-model="newUrl"
          data-testid="blueprint-registry-url"
          :placeholder="t('blueprints.market.registryPlaceholder')"
          class="min-w-0 flex-1 rounded-[4px] border border-border bg-input px-2 py-1.5 font-mono text-[12px] text-fg"
          spellcheck="false"
        />
        <button
          type="submit"
          data-testid="blueprint-registry-add"
          class="cursor-pointer rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[12px] text-fg hover:bg-hover disabled:opacity-40"
          :disabled="!newUrl.trim()"
        >
          {{ t("blueprints.market.addRegistry") }}
        </button>
      </form>
    </section>

    <p v-if="error" data-testid="blueprint-market-error" class="m-0 whitespace-pre-wrap font-sans text-[12px] text-err-text">{{ error }}</p>

    <section v-for="registry in catalog.registries" :key="registry.url" class="flex flex-col gap-2">
      <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ registry.name }}</h3>
      <p v-if="registry.error" class="m-0 font-sans text-[12px] text-err-text">{{ t("blueprints.market.registryError", { error: registry.error }) }}</p>
      <p v-else-if="!registry.packs.length" class="m-0 font-sans text-[12px] text-dim">{{ t("blueprints.market.empty") }}</p>
      <article
        v-for="pack in registry.packs"
        :key="pack.slug"
        data-testid="blueprint-market-pack"
        class="flex flex-col gap-1 rounded-md border border-border bg-panel p-3"
      >
        <div class="flex items-center gap-2">
          <span class="font-sans text-[13px] font-[650] text-fg">{{ pack.title }}</span>
          <span class="rounded-[4px] bg-base px-1.5 py-0.5 font-sans text-[11px] text-secondary">
            {{ pack.kind === "base" ? t("blueprints.market.kindBase") : t("blueprints.market.kindUsecase") }}
          </span>
          <span class="flex-1"></span>
          <span v-if="pack.builtin" class="font-sans text-[11px] text-dim">{{ t("blueprints.market.builtin") }}</span>
          <template v-else>
            <span v-if="pack.installed" class="font-sans text-[11px] text-ok">{{
              t("blueprints.market.installedFrom", { commit: shortCommit(pack.installed.commit) })
            }}</span>
            <button
              type="button"
              data-testid="blueprint-install"
              class="cursor-pointer rounded-[4px] border-none bg-accent px-3 py-1 font-sans text-[12px] text-on-accent disabled:opacity-40"
              :disabled="busy !== null"
              @click="install(registry.url, pack)"
            >
              {{ busy === pack.slug ? t("blueprints.market.working") : pack.installed ? t("blueprints.market.update") : t("blueprints.market.install") }}
            </button>
            <button
              v-if="pack.installed"
              type="button"
              data-testid="blueprint-uninstall"
              class="cursor-pointer rounded-[4px] border border-border bg-base px-3 py-1 font-sans text-[12px] text-secondary hover:bg-hover disabled:opacity-40"
              :disabled="busy !== null"
              @click="uninstall(pack)"
            >
              {{ t("blueprints.market.uninstall") }}
            </button>
          </template>
        </div>
        <p v-if="pack.description" class="m-0 font-sans text-[12px] text-secondary">{{ pack.description }}</p>
        <p class="m-0 truncate font-mono text-[11px] text-dim">{{ pack.repo }} · {{ pack.ref }}{{ pack.path ? ` · ${pack.path}` : "" }}</p>
      </article>
    </section>
  </div>
</template>
