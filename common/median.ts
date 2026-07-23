// The middle value of a set of numbers, or null when there is nothing to measure.
//
// For an even count there are two middle values; the median is their AVERAGE. Returning
// the upper one instead skews every even-length measurement toward the slower half — which
// is what happened to the model-trial timings that get transcribed into the preset table
// (a 2/3-passing model records two numbers, an even count, on every run).
export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};
