# fix — grid expand 時のロスター行にディレクトリの header color を反映

## 要望

grid expand したとき、サイドメニューのロスター（既定の cockpit リスト表示）のターミナル行に、ユーザーがディレクトリごとに設定した header color が反映されない。反映してほしい。

## 現状

- **フィルムストリップ**（`listMode=false`）は完全な `TerminalCell` を描画するので header color は出る
- **ロスター**（`listMode=true`、既定）は `CockpitRow`（テキスト行）で描画され、`headerColor` を持たず、status 色と固定枠だけ。ディレクトリ設定（`.mulmoterminal.json` の `headerColor`）が反映されない

## 変更

**ロスター行の上部（status バッジ ＋ ディレクトリ名の行）をヘッダー帯にして、そこに header color の背景をつける。**（行まるごとは重すぎたため、実機フィードバックでヘッダー帯方式に変更）

`phaseByCwd` と同じ reactive Map パターンを `chromeByCwd` として追加:

- `GridView.vue`: `chromeByCwd`（cwd → `{headerColor, headerTextColor}`）を `fetchDirConfig`（共有キャッシュ）から seed。`dir-config` pubsub チャネルを購読し、`.mulmoterminal.json` 編集時に該当 cwd を invalidate + 再 seed → 開いたままのロスターがリロードなしで再着色。`forgetClosedCells` で prune
- `listRows` に `headerColor` / `headerTextColor` を追加
- `TerminalGrid.vue`: `CockpitRow` に2フィールド追加。**行の上部の status+cwd の span をヘッダー帯**にし、`:style="headerStyleFor(...)"`（既存の純関数を再利用）＋ `bg-[var(--cell-header-bg,transparent)]` を適用。負マージン（`-mx-2.5 -mt-2`）で行の上端・両端まで帯を伸ばす。行本体（summary/prompt/reply）はテーマ既定のまま。cwd テキストは `text-[var(--cell-header-fg,var(--text-dim))]` で、色付き帯では headerTextColor、未設定では従来の dim

未設定のディレクトリは CSS 変数がセットされず、ヘッダー帯は透明（＝行と一体で従来の見た目）にフォールバック。

### TDZ 注意

`chromeByCwd` は `forgetClosedCells` より前に宣言する必要がある（cells-key watch が `immediate: true` で setup 中に `forgetClosedCells` を呼ぶため）。

## テスト

- ロスター行が `headerColor`/`headerTextColor` から `--cell-header-bg`/`--cell-header-fg` を適用すること（TerminalGrid をマウントして検証）
- 未設定時は変数を出さないこと
- `:style` 束縛を外すと赤くなることを確認済み

## 未検証

実際の色の見た目は実機で要確認（染まること・可読性）。配線とレンダリングはコンポーネントテストで担保。
