import { ref } from "vue";
import { DEFAULT_COCKPIT_LINES, type CockpitLines } from "../../common/cockpitLines";

// The active cockpit clamp, hydrated once from /api/config. A SINGLETON ref for the same reason
// the other config values are: the settings load happens in useAppConfig, while the roster that
// renders from it lives in TerminalGrid — a per-caller ref would leave the grid on the defaults.
// A ref rather than a plain value (unlike terminalSubmitMode): this one is read from a template,
// so it has to re-render when the config arrives.
const cockpitLines = ref<CockpitLines>(DEFAULT_COCKPIT_LINES);

export const useCockpitLines = () => cockpitLines;
export const setCockpitLines = (lines: CockpitLines): void => {
  cockpitLines.value = lines;
};
