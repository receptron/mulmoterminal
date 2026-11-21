import { ref } from "vue";

// Bumped whenever what listSlots() would answer may have changed — a cell opening, closing, getting
// its session or directory, connecting or dropping — so a computed over listSlots() can follow it.
// listSlots() reads the connection runtime, which Vue does not track.
export const slotsVersion = ref(0);

export const slotsChanged = (): void => {
  slotsVersion.value++;
};
