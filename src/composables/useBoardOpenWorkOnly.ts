import { ref } from "vue";

// Whether the GitHub board shows only the work a terminal is open on (#3359).
//
// On by default: what the board is opened for is the work in flight; the full list of open issues
// is one click away on the list view. Per browser, like the issue-start agent pick beside it.
const STORAGE_KEY = "githubBoardOpenWorkOnly";
const DEFAULT_ON = true;

// Only the exact string "0" turns it off, so an unset or corrupt value lands on the default.
function loadOn(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_ON : stored !== "0";
  } catch {
    return DEFAULT_ON;
  }
}

const on = ref<boolean>(loadOn());

export function useBoardOpenWorkOnly() {
  function setBoardOpenWorkOnly(next: boolean) {
    on.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // storage blocked: the choice still applies for this page, it just is not remembered
    }
  }
  return { boardOpenWorkOnly: on, setBoardOpenWorkOnly };
}
