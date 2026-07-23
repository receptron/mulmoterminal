// The estimated-cost figures in Settings (Session / Today / Month). A money string that
// looks right is believed, so the two edges that would quietly mislead get their own rule:
// an absent value reads as "—" rather than "$0.00" (nothing loaded yet is not "free"), and a
// positive amount under a cent reads as "<$0.01" rather than rounding down to "$0.00" (a real
// cost must never render as no cost). Everything else is a plain two-decimal dollar amount.
const CENT_USD = 0.01;

export function formatUsd(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value > 0 && value < CENT_USD) return "<$0.01";
  return `$${value.toFixed(2)}`;
}
