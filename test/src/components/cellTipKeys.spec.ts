// The cell's hover tips and aria-labels are translated (#2408), and stay that way.
//
// A key is just a `string` to the type checker, so `tips.cell.moveLefft` compiles and renders the
// key path on screen; and a new button written with `data-tip="Foo"` compiles too, in English
// for every locale. tipCensus.ts catches both by reading the sources below.
import { describe, it, expect } from "vitest";
import { describeTipSurface, hardcodedTips } from "./tipCensus";
import TerminalCellSource from "../../../src/components/TerminalCell.vue?raw";
import CellShellSource from "../../../src/components/CellShell.vue?raw";
import CellChromeButtonsSource from "../../../src/components/CellChromeButtons.vue?raw";
import CommandCellSource from "../../../src/components/CommandCell.vue?raw";
import LauncherCellSource from "../../../src/components/LauncherCell.vue?raw";
import TerminalSource from "../../../src/components/Terminal.vue?raw";
import TerminalGridSource from "../../../src/components/TerminalGrid.vue?raw";
import CellTidyPromptSource from "../../../src/components/CellTidyPrompt.vue?raw";
import WorkCommentNoticeSource from "../../../src/components/WorkCommentNotice.vue?raw";
import IssueStartButtonSource from "../../../src/components/IssueStartButton.vue?raw";
import PinToggleSource from "../../../src/components/PinToggle.vue?raw";
import AccountMarkSource from "../../../src/components/AccountMark.vue?raw";
import CollectionMarkSource from "../../../src/components/CollectionMark.vue?raw";
import PeerNameChipSource from "../../../src/components/PeerNameChip.vue?raw";
import workCommentNoticeSource from "../../../src/composables/workCommentNotice.ts?raw";

// The surface this section covers. A file added to the cell's chrome belongs here too.
const CELL_SOURCES: Record<string, string> = {
  "TerminalCell.vue": TerminalCellSource,
  "CellShell.vue": CellShellSource,
  "CellChromeButtons.vue": CellChromeButtonsSource,
  "CommandCell.vue": CommandCellSource,
  "LauncherCell.vue": LauncherCellSource,
  "Terminal.vue": TerminalSource,
  "TerminalGrid.vue": TerminalGridSource,
  "CellTidyPrompt.vue": CellTidyPromptSource,
  "WorkCommentNotice.vue": WorkCommentNoticeSource,
  "IssueStartButton.vue": IssueStartButtonSource,
  "PinToggle.vue": PinToggleSource,
  "AccountMark.vue": AccountMarkSource,
  "CollectionMark.vue": CollectionMarkSource,
  "PeerNameChip.vue": PeerNameChipSource,
  "workCommentNotice.ts": workCommentNoticeSource,
};

describeTipSurface("cell", CELL_SOURCES);

describe("the hard-coded-tip pattern", () => {
  // The pattern has to see the two shapes it exists for, or the test above passes by matching nothing.
  it.each([
    ['<button data-tip="Close terminal">', true],
    [`<button :data-tip="open ? 'Restore' : t('x')">`, true],
    ['<button :aria-label="`Close ${dir}`">', true],
    ['<span :data-tip="`${count} incoming link(s)`">', true],
    ['<FilesToolbarButton icon="refresh" label="Reload tree" />', true],
    ['<LauncherButton\n  icon="rss_feed"\n  title="Feeds"\n/>', true],
    [`<FilesToolbarButton :label="open ? 'Reload tree' : t('x')" />`, true],
    ['<LaunchAgentPicker :description="`Agent ${name}`" />', true],
    [`<FilesToolbarButton icon="refresh" :label="t('tips.panes.reloadTree')" />`, false],
    ['<iframe\n  sandbox="allow-scripts"\n  title="Markdown preview"\n/>', true],
    [`<iframe :title="t('tips.panes.markdownPreview')" />`, false],
    [`<button :data-tip="t('tips.cell.closeTerminal')">`, false],
    [`<button :data-tip="ahead === 0 ? t('a') : 'git push -u origin'">`, false],
  ])("the pattern judges %s as hard-coded: %s", (markup, hardcoded) => {
    expect(hardcodedTips(markup).length > 0).toBe(hardcoded);
  });
});
