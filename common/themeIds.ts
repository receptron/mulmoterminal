// The app's theme ids, shared across the build boundary: the server's zod schema
// (config-schema.ts) enumerates them and the client (useTheme.ts) types + validates
// against them. Kept in common/ so adding a theme is one edit, not two that can
// drift — same reason THEME_COLOR_KEYS lives here (see themeColors.ts).
export const THEME_IDS = ["midnight", "nord", "daylight", "solarized"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
