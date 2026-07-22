// Which directory the launch form offers, and when it may be changed for the user.
//
// The consequence of getting either wrong is the same: the user presses Enter and starts an
// agent in the wrong repository. `presets` and `defaultCwd` arrive asynchronously from
// /api/config, so a cell opened before that lands starts with a blank or stale field and has
// to be upgraded when it arrives — without ever overwriting the path the user just typed.

export interface LaunchDirSources {
  // This cell's persisted directory, restored from the grid layout.
  initialCwd?: string | null;
  // The user's recent directories, most recent first.
  presets: readonly { path: string }[];
  // The server's workspace default.
  defaultCwd?: string | null;
}

// Persisted cell dir → most recent preset → server default → empty.
export function preferredLaunchDir({ initialCwd, presets, defaultCwd }: LaunchDirSources): string {
  return initialCwd ?? presets[0]?.path ?? defaultCwd ?? "";
}

export interface LaunchDirSyncFacts {
  // A cell restored with its own directory already knows better than any default.
  hasInitialCwd: boolean;
  // The user typed in or picked a directory — never overwrite that.
  touched: boolean;
  // The cell already launched; its field is history.
  launched: boolean;
}

// Whether late-arriving config may still upgrade the field. The `touched` guard is the one
// that matters most: config can land one keystroke before the user hits Go.
export function shouldSyncLaunchDir({ hasInitialCwd, touched, launched }: LaunchDirSyncFacts): boolean {
  return !hasInitialCwd && !touched && !launched;
}
