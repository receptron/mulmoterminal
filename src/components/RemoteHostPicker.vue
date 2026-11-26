<script setup lang="ts">
// Where the launch panel starts the next terminal: this machine, or one of the remote hosts (#3506).
// A host that is not reachable stays listed but disabled, with the reason as its tip, so a closed
// tunnel reads as a closed tunnel rather than as a host that was never configured.
import { useI18n } from "vue-i18n";
import { canStartOn } from "./remoteLaunch";
import type { RemoteHostSummary } from "../../common/remoteHosts";

const { t } = useI18n();

defineProps<{
  hosts: RemoteHostSummary[];
  // The picked host's id, or null for this machine.
  modelValue: string | null;
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: string | null): void }>();

const OPTION = "cursor-pointer rounded-md border px-2.5 py-1 text-[12px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const optionClass = (picked: boolean) => [OPTION, picked ? "border-accent bg-accent/15 text-fg" : "border-border bg-transparent text-secondary hover:text-fg"];

// aria-disabled rather than disabled: a disabled button gets no hover, so its reason would never show.
const pick = (host: RemoteHostSummary) => {
  if (canStartOn(host)) emit("update:modelValue", host.id);
};

const unavailableTip = (host: RemoteHostSummary): string | undefined => {
  if (host.state === "unreachable") return t("tips.launch.remote.unreachable", { label: host.label });
  if (host.state === "version-mismatch") return t("tips.launch.remote.versionMismatch", { label: host.label });
  return undefined;
};
</script>

<template>
  <div
    data-testid="remote-host-picker"
    class="flex w-full flex-wrap items-center gap-1.5 px-4 pt-4"
    role="radiogroup"
    :aria-label="t('tips.launch.remote.runOn')"
  >
    <span class="text-[11px] text-secondary">{{ t("tips.launch.remote.runOn") }}</span>
    <button type="button" role="radio" :aria-checked="modelValue === null" :class="optionClass(modelValue === null)" @click="emit('update:modelValue', null)">
      {{ t("tips.launch.remote.thisMachine") }}
    </button>
    <button
      v-for="host in hosts"
      :key="host.id"
      type="button"
      role="radio"
      :data-testid="`remote-host-${host.id}`"
      :aria-checked="modelValue === host.id"
      :aria-disabled="!canStartOn(host)"
      :data-tip="unavailableTip(host)"
      :class="optionClass(modelValue === host.id)"
      @click="pick(host)"
    >
      <span class="material-symbols-outlined text-[13px] align-[-2px]" aria-hidden="true">dns</span>
      {{ host.label }}
    </button>
  </div>
</template>
