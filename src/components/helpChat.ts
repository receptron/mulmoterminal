// The help desk, opened the same way from every surface that offers it (the toolbar icon, Settings'
// Help section): one chat, seeded with the bundled help skill.
import type { BundledSkillName } from "../../common/bundledSkills";
import { launchAgent, startCollectionChat, type SpawnedChat } from "../composables/useChatLauncher";
import { skillSeed } from "./skillSeed";

export const HELP_SKILL: BundledSkillName = "mulmoterminal-help";

/** Always the WORKSPACE, whatever collection is on screen: the question is about the app, and a
 *  help session filed under the project someone happened to be browsing would read as that
 *  project's work. The agent is the Launch picker's current choice, seeded in the form it reads. */
export const openHelpChat = (): Promise<SpawnedChat | null> => startCollectionChat(skillSeed(HELP_SKILL, launchAgent.value), { project: null });
