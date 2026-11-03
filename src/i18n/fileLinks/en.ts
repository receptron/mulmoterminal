// A path clicked in the terminal: its menu, and what a tab says when a file outside the cell
// cannot be shown (#3024). Out of the locale file, which is at its line cap.
export const fileLinksEn = {
  pathMenu: {
    insertFilePath: "Insert a file path",
    reveal: "Reveal in the file manager",
    browseFiles: "Browse files in the app",
    dirSettings: "This directory's settings",
    newTerminal: "New terminal here",
  },
  linkMenu: {
    title: "Open this path",
    openInPane: "Open in the pane",
    openInTab: "Open in a new tab",
    openInFiles: "Open in the Files view",
    copyPath: "Copy the path",
    copied: "Path copied",
    copyFailed: "The path could not be copied: {path}",
  },
  outsideFile: {
    missing: "{path} is not there anymore.",
    refused: "{path} could not be opened in a tab.",
  },
};
