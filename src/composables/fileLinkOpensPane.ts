import { createGlobalFlag } from "./globalFlag";

// Whether a file path clicked in terminal output opens the Files pane beside its own cell on the
// tiled grid (#3238), hydrated from /api/config and read by the grid at click time. On unless the
// config says `false`: a click then keeps the route it had — a new tab, or the in-app Files view —
// except where a pane is already up beside that cell.
const flag = createGlobalFlag("fileLinkOpensPane", true);

export const fileLinkOpensPane = flag.state;
export const isFileLinkOpensPaneEnabled = flag.read;
export const setFileLinkOpensPane = flag.set;
export const saveFileLinkOpensPane = flag.save;
