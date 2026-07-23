# feat #710 — 共有 CockpitHeader（roster と strip サムネイルで同じヘッダー表示）

対象 issue: https://github.com/receptron/mulmoterminal/issues/710

## 背景

strip サムネイルの header は `TerminalCell` の cell-header で、dir 色は **idle のときだけ**適用され、working/done/blocked ではステータス色が上書きする。roster はステータスに関係なく**常に dir 色**をバーに出す。ユーザーは strip サムネイルも roster と同じ（色＋ラベル）にしたい。共有コンポーネント化も希望。

## 実装

### `src/components/CockpitHeader.vue`（新規）
roster 行ヘッダーを部品化：色付きバー（`--cell-header-bg` を常時＝dir 色、`headerStyleFor`）＋ ステータスドット ＋ バッジ（`statusWord`：running/waiting/done/idle、working+workPhase は WORK_WORD）＋ 任意 phase バッジ ＋ 任意 codex タグ ＋ dir（`formatCwd`）＋ 末尾 `<slot />`。
- props: `status, agent, cwd, home, headerColor, headerTextColor, workPhase?, phase?, dirLength=44`。
- DOT_CLASS / BADGE_CLASS / PHASE_CLASS / statusWord / phaseClass を TerminalGrid から移設（一元化）。負のマージン等の位置調整は呼び出し側の passthrough class。

### `TerminalGrid.vue`（roster）
インラインの cockpit-header を `<CockpitHeader class="-mx-2.5 -mt-2 ...">` に置換。末尾スロットに `CockpitRowMenu`(⋮)。`data-testid="cockpit-header"` / `cockpit-badge` は CockpitHeader 側に付けて維持。移設した定数・helper を削除。

### `TerminalCell.vue`（strip サムネイル）
`filmstrip`(zoomed && !expanded) のとき、cell-header を `<CockpitHeader class="cell-header is-zoomable ..." :status :agent :cwd :home :header-color=dirConfig.headerColor :header-text-color=dirConfig.headerTextColor @click="onHeaderClick">` に置換し、末尾スロットに expand/close(`cell-actions`)。dir 色は常時適用・ラベルは roster と同じ。通常グリッド（非 filmstrip）は現状の cell-header のまま。

## テスト
- `CockpitHeader.spec`：色（headerStyleFor で `--cell-header-bg`）・ラベル（各 status / workPhase）・phase/codex 有無・dir 整形・slot。
- `TerminalGrid.spec`：roster が CockpitHeader を使い cockpit-header/badge を維持、⋮ が slot で出る。
- `TerminalCell.spec`：filmstrip の header が CockpitHeader（dir 色常時＋バッジ）になり、click で zoom、expand/close が残ることを更新。

変異テストで「壊すと落ちる」ことを確認してからマージ。
