// The browser's language as a bare language subtag — `ja`, `en`, `zh`.
//
// The same expression had been written out in five places (App, the collection and
// accounting UIs, voice input, the command cell). They agreed, but each was one edit away
// from not agreeing, and "which locale does this part of the app think it is in" is not a
// question worth having five answers to.
//
// The region is dropped on purpose: callers use this to pick a translation bundle, and
// `en-GB` and `en-US` want the same one. A caller that needs the full tag should read
// `navigator.language` itself and say why.
export function browserLocale(): string {
  return (navigator.language || "en").split("-")[0];
}
