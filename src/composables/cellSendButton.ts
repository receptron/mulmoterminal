import { createGlobalFlag } from "./globalFlag";

// Whether a cell shows its own "send to <partner>" button on header row 2 (#3399), hydrated from
// /api/config. On unless the config says `false`.
const flag = createGlobalFlag("cellSendButton", true);

export const cellSendButton = flag.state;
export const setCellSendButton = flag.set;
export const saveCellSendButton = flag.save;
