# feat: ターミナルのファイルリンクを右クリックして開き方を選ぶ（#3238 の分割 2）

## 背景

ターミナル出力のファイルパスは左クリックで開く（ペインが先に受け取り、辞退されれば拡張子で振り分け）。
Cmd / Ctrl を押したクリックは新しい Files タブ（#3005）。開き方を明示的に選ぶ手段は無かった。

## 方針

- リンクの上で右クリックしたときだけ、アプリのメニューを出す。リンクの外では `preventDefault` せず、
  ブラウザのメニュー（貼り付けなど）をそのまま残す。
- 項目は四つ（issue で決めたもの）。
  - ペインで開く: 左クリックと同じ（ペインが先、辞退されれば拡張子の経路）。タイル表示の自動オープン
    （分割 4）が入るまでは、ペインが無いときは左クリックと同じ先に行く。
  - 新しいタブで開く: ペインを介さず拡張子の経路。ソースは（クリックではアプリ内の Files ビューに行くが）
    Files ページを新しいタブで開く。セルの外の画像などは一ファイル用の許可で開く。
  - Files ビューで開く: このタブの Files ビュー。
  - パスをコピー: 絶対パス（相対なら cwd に結合。Windows のセルは `\` で結合。`..` は経路と同じ再基点化）。
    クリップボードが無いページでは項目を出さない。

## 仕組み

- `terminalFilePathLinkProvider.ts`: xterm の `ILink` に `hover` / `leave` を付け、指しているリンクを
  呼び出し側に知らせる。クリックの後半（経路で開く）を `openLinkByRoute` に切り出し、クリックとメニューで
  共用する。`resolveLinkPath` で基点と相対パスの解決も共用。
- `terminalFileLinks.ts`: ホバー中のリンクを覚え、`term.element` の `contextmenu` で
  `requestLinkMenu` に渡す（ターミナル一つにつき一回だけ配線される）。
- `terminalLinkMenu.ts`: 要求を持つモジュール単位の状態。提供側は接続ごと、メニューは全体で一つなので、
  `filesPaneOpener.ts` と同じ形で結ぶ。
- `terminalLinkActions.ts`: 四つの動作を純関数に。
- `TerminalLinkMenu.vue`: `App.vue` に一つ。ポインタ位置に開き（画面の端では内側へ）、Esc と外側の
  ポインタダウンとスクロールで閉じる。
- 文言は `src/i18n/fileLinks/*.ts` の `linkMenu`（五言語）。

## 仕様書

- `test/src/composables/terminalLinkActions.spec.ts`: 四つの動作と絶対パスの組み立て。
- `test/src/composables/terminalFileLinks.spec.ts`: 実物の xterm で、リンク上の右クリックだけがメニューを
  要求し、既定の動作を止めること。
- `test/src/components/TerminalLinkMenu.spec.ts`: 表示位置、四項目、各動作、閉じ方。
- `test/src/terminalFilePathLinkProvider.integration.spec.ts`: `hover` / `leave` の通知。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`。実機でもリンクを右クリックして
メニューが出ること、リンク外ではブラウザのメニューが出ることを確認する。
