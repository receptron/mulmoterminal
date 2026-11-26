# What's new dialog: a thank-you note in the header (#3565)

## Goal
After an upgrade, the What's new dialog announces the new version, thanks the user, and asks them
politely to tell friends or post about MulmoTerminal on social media or a blog.

## Approach
- `whatsNew.intro` now reads as an announcement ("{version} is out!").
- New key `whatsNew.thanks`, rendered under the intro in a bordered box with the Material Symbols
  `favorite` icon (no emoji, per the repo rule).
- All five locales (en, ja, ko, zh-CN, zh-TW).
- `en.ts` / `ja.ts` were at the `max-lines` cap, so the `whatsNew` section moves to
  `src/i18n/whatsNew/<locale>.ts`, the same pattern as `releaseNotes/`.

## Out of scope
- Links to specific social networks or a share button.
