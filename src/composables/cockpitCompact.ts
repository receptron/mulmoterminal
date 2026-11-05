import { createGlobalFlag } from "./globalFlag";
import { COCKPIT_COMPACT_DEFAULT } from "../../common/cockpitCompact";

// Whether each cockpit-roster row is cut to its header and the session's name (#3270), hydrated from
// /api/config. The default lives in common/cockpitCompact.ts; the key stays literal here, for the
// reason common/showLoadAverage.ts gives.
const flag = createGlobalFlag("cockpitCompact", COCKPIT_COMPACT_DEFAULT);

export const cockpitCompact = flag.state;
export const setCockpitCompact = flag.set;
export const saveCockpitCompact = flag.save;
