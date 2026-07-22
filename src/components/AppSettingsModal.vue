<script setup lang="ts">
// The settings modal with its config wiring already attached.
//
// Both shells open the same modal — the chat view and the grid — and each wired the same five
// values and five save handlers to it by hand. Ten identical lines in two places is how one
// of them ends up missing a setting added later, and the symptom would be a control that
// silently does nothing in one view (#646 A5).
//
// useAppConfig's state is a singleton, so reading it here is the same state the shells read.
// What genuinely differs stays a prop or an event: the chat view knows a cwd and a session,
// and each shell configures appearance its own way.
import { useAppConfig } from "../composables/useAppConfig";
import SettingsModal from "./SettingsModal.vue";

defineProps<{ cwd?: string | null; sessionId?: string | null }>();
const emit = defineEmits<{ (e: "configure-appearance" | "close"): void }>();

const { soundFile, saveSound, pushEnabled, savePushEnabled, prRepos, savePrRepos, launchers, saveLaunchers, userMcpServers, saveUserMcpServers } =
  useAppConfig();
</script>

<template>
  <SettingsModal
    :sound-file="soundFile"
    :push-enabled="pushEnabled"
    :pr-repos="prRepos"
    :launchers="launchers"
    :user-mcp-servers="userMcpServers"
    :cwd="cwd"
    :session-id="sessionId"
    @update-sound="saveSound"
    @update-push-enabled="savePushEnabled"
    @update-repos="savePrRepos"
    @update-launchers="saveLaunchers"
    @update-user-mcp="saveUserMcpServers"
    @configure-appearance="emit('configure-appearance')"
    @close="emit('close')"
  />
</template>
