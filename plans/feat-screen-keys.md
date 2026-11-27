# Keys for the feature-menu screens (#3575, part 2 of 3)

Part 1 keeps the screens alive; this part makes them reachable from the keyboard.

## What

- `screen-library`, `screen-processes`, `screen-usage`: the three More-features screens that had no
  action. They go through `SCREEN_ACTIONS`, so a `keymap` binding and a `run: "action"` header
  button both reach them. Library joins `PALETTE_SCREENS`, which also gives it a command-palette row
  (Processes and Usage already had one).
- `screen-toggle`: one key between the screen opened last and the view it was opened from.
  - On a screen (any route in `OVERLAY_ROUTES`): go to `overlayReturnPath()`, as closing does.
  - Elsewhere: go back to the last screen's full path, recorded by `lastPlaceIn(OVERLAY_ROUTES)`,
    with a fresh origin. False (the header button says so) when no screen was opened yet.
  - The path is resolved before the push: a `{ path }` carrying a query string is pushed without
    it, and the Library keeps the open conversation in `?session=`.

## Not here

- Screen tabs: part 3.
- No default binding: the keymap has no defaults by design.
