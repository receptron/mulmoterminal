// The name + fixed-color fields a `.mulmoterminal.json` may set. Shared across the
// build boundary: the server's DirConfig/PublicDirConfig and the client's DirConfig
// all extend this, so a field added on one side can't go missing on the other.
// `theme` and `colors` stay out of it — each side declares them with its own type
// (the server keeps the validated strings, the client narrows them to xterm's ITheme).
export interface DirChrome {
  name: string | null;
  badgeColor: string | null;
  // The cell header's own background / text color (grid cell + single view). Hex
  // #rrggbb, or null to keep the theme default. Distinct from `colors` (the xterm
  // palette) — these tint the chrome around the terminal, not the terminal itself.
  headerColor: string | null;
  headerTextColor: string | null;
  // The cell frame + accents (grid cell): body background, border, the idle status
  // dot, and the header's icon buttons. Hex #rrggbb or null for the theme default.
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
}
