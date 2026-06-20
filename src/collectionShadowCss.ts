// The compiled CSS injected into the collection plugin's Shadow DOM — used by both
// the chat card (plugins-registry) and the full-screen browse overlay. Combines the
// package's Tailwind sheet with an icon rule, since:
//   - the package's `style.css` carries its components' Tailwind classes, but
//   - the plugin renders ~56 `.material-icons` glyphs whose class rule can't pierce
//     the shadow root (and `material-icons` isn't loaded), so map both icon classes
//     to the globally-loaded "Material Symbols Outlined" font (same ligature names).
// Prepended BEFORE the Tailwind sheet so the components' `text-sm`/`text-lg` size
// overrides still win; unsized icons fall back to the 24px default here.
import collectionCss from "@mulmoclaude/collection-plugin/style.css?inline";

const ICON_CSS = `
.material-icons, .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: "liga";
}
`;

export const collectionShadowCss = ICON_CSS + collectionCss;
