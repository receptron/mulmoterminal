// How each palette screen is opened: the same functions the toolbar's buttons call.
import { router } from "../router";
import { accountingViewOpen } from "./useAccountingView";
import { blueprintsViewOpen } from "./useBlueprintsView";
import { browseGotoIndex } from "./useCollectionBrowse";
import { filesGotoIndex } from "./useFilesView";
import { githubGotoIndex } from "./useGithubView";
import { libraryViewOpen } from "./useLibraryView";
import { roomsViewOpen } from "./useRoomsView";
import { skillsViewOpen } from "./useSkillsView";
import { processesViewOpen } from "./useProcessesView";
import { usageViewOpen } from "./useUsageView";
import { wikiGotoIndex, wikiGotoTag } from "./useWikiBrowse";
import { WORKLOG_TAG } from "./worklog";
import type { PaletteScreen } from "./paletteScreens";

export const SCREEN_OPENERS: Record<PaletteScreen, () => void> = {
  terminals: () => void router.push("/terminals"),
  collections: () => browseGotoIndex("collection"),
  feeds: () => browseGotoIndex("feed"),
  accounting: accountingViewOpen,
  files: () => filesGotoIndex(null),
  wiki: wikiGotoIndex,
  prs: githubGotoIndex,
  rooms: () => roomsViewOpen(),
  blueprints: () => blueprintsViewOpen(),
  worklog: () => wikiGotoTag(WORKLOG_TAG),
  skills: skillsViewOpen,
  library: () => libraryViewOpen(),
  processes: processesViewOpen,
  usage: usageViewOpen,
};
