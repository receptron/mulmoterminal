# fix — grid expand 時のロスター行にディレクトリの header color を反映

## 要望

grid expand したとき、サイドメニューのロスター（既定の cockpit リスト表示）のターミナル行に、ユーザーがディレクトリごとに設定した header color が反映されない。反映してほしい。

## 現状

- **フィルムストリップ**（`listMode=false`）は完全な `TerminalCell` を描画するので header color は出る
- **ロスター**（`listMode=true`、既定）は `CockpitRow`（テキスト行）で描画され、`headerColor` を持たず、status 色と固定枠だけ。ディレクトリ設定（`.mulmoterminal.json` の `headerColor`）が反映されない

## 変更

**ロスター行の背景を、そのターミナルの header color に染める。**（見た目はユーザー選択）

`phaseByCwd` と同じ reactive Map パターンを `chromeByCwd` として追加:

- `GridView.vue`: `chromeByCwd`（cwd → `{headerColor, headerTextColor}`）を `fetchDirConfig`（共有キャッシュ）から seed。`dir-config` pubsub チャネルを購読し、`.mulmoterminal.json` 編集時に該当 cwd を invalidate + 再 seed → 開いたままのロスターがリロードなしで再着色。`forgetClosedCells` で prune
- `listRows` に `headerColor` / `headerTextColor` を追加
- `TerminalGrid.vue`: `CockpitRow` に2フィールド追加。ロスター行に `:style="headerStyleFor(row.headerColor, row.headerTextColor)"`（既存の純関数を再利用）を適用し、背景を `bg-[var(--cell-header-bg,var(--bg-panel))]`、文字色を `text-[var(--cell-header-fg,var(--text))]` に。TerminalCell のヘッダーと同じ CSS 変数の使い方

未設定のディレクトリは CSS 変数がセットされず、テーマ既定（`--bg-panel` / `--text`）にフォールバック。

### TDZ 注意

`chromeByCwd` は `forgetClosedCells` より前に宣言する必要がある（cells-key watch が `immediate: true` で setup 中に `forgetClosedCells` を呼ぶため）。

## テスト

- ロスター行が `headerColor`/`headerTextColor` から `--cell-header-bg`/`--cell-header-fg` を適用すること（TerminalGrid をマウントして検証）
- 未設定時は変数を出さないこと
- `:style` 束縛を外すと赤くなることを確認済み

## 未検証

実際の色の見た目は実機で要確認（染まること・可読性）。配線とレンダリングはコンポーネントテストで担保。
