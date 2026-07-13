# fix: Web Push toggle isn't saved in the grid view (#347)

## Symptom

Settings → "Notify my devices when a task finishes" (Web Push, `pushEnabled`) is not
saved **in the grid view**: the checkbox reads unchecked even when the server has
`pushEnabled: true`, and toggling it does not persist (no `POST /api/config`).

## Root cause

There are TWO `<SettingsModal>` instances:
- App.vue's (single view) — wired for push in #340.
- **GridView.vue's (grid view) — never wired for push.**

GridView's `<SettingsModal>` was missing `:push-enabled` and `@update-push-enabled`, so
in the grid view the checkbox has no prop (renders `false` regardless of the saved
value via `:checked="props.pushEnabled ?? false"`) and toggling emits an event nothing
handles (no save). The user was in the grid view, so it looked "not saved".

## Fix

`src/components/GridView.vue`:
- Pull `pushEnabled` + `savePushEnabled` from `useAppConfig()`.
- Wire `:push-enabled="pushEnabled"` + `@update-push-enabled="savePushEnabled"` on
  `<SettingsModal>`, matching App.vue.

## Verification

- Puppeteer (current source, vite): before → grid checkbox `false` while `/api/config`
  `pushEnabled: true`, toggling fired no POST. After → checkbox reflects config, toggling
  POSTs `{ pushEnabled }` and persists (verified across close/reopen).
- Added `SettingsModal.spec` coverage: the push checkbox reflects the `pushEnabled` prop
  and emits `update-push-enabled` on toggle.
- Gates: format / lint / typecheck / build / test.

## Out of scope (noted on the issue)

An old mulmoterminal instance (pre-#340) sharing `~/.mulmoterminal/config.json` drops
`pushEnabled` on any config write because its schema doesn't know the field — restart /
update such instances. A forward-compat "preserve unknown config keys" change could
harden future version-skew but is separate.
