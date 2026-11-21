// Which optional features are set up, for everything that offers a way into them: the toolbar and
// the command palette answer the same question, so they ask the same place.
import { computed, type ComputedRef } from "vue";
import { visibleGatedEntries, type GatedEntry } from "../components/gatedToolbarEntries";
import { useAppConfig } from "./useAppConfig";
import { roomsExist } from "./useRooms";
import { worklogEnabled } from "./worklog";

export function useGatedEntries(): ComputedRef<Record<GatedEntry, boolean>> {
  const { prRepos } = useAppConfig();
  return computed(() =>
    visibleGatedEntries({
      prRepoCount: prRepos.value.length,
      roomsExist: roomsExist.value,
      worklogEnabled: worklogEnabled.value,
    }),
  );
}
