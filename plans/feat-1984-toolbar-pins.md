# feat: よく使うコレクションをツールバーから一手で開く (#1984)

## 問題

ワークスペースのコレクション（works / todos / calendar / email-triage …）を開くのに必ず 2 手かかる。
ツールバーの **Collections** を押してオーバーレイを出し、その上端の Pinned 行からアイコンを選ぶ。
ピン留めした項目はオーバーレイを開くまで画面のどこにも出てこないので、グリッドに戻るたびに同じ 2 手を踏む。

報告者はピンを 9 件持っていて、そのうち日に何十回も開くのは 3 件。

## 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 出し方 | ピンのうち**自分で選んだ数件だけ**をツールバーに出す（上限 5） | 9 件を常時並べるとグリッドのヘッダー（PR / Rooms / Worklog / ＋ / 並び順 / 状態タリー / ゲージ）と競合して横スクロールに落ちる。「1 手で届く」が壊れては意味がない。0 件＝今までと同じ画面 |
| ON/OFF フラグ | **作らない** | 選んだリストそのものがスイッチ。空なら何も出ない |
| 置き場所 | `Grid / Collections` の切り替えグループの**右**に、自前の区切り線を持つ別グループ | ピンを押すとビューを離れてコレクションに行く＝**ドア**。#941 が引いた「左＝どのビューにいるかを変える / 右＝今いるビューの中で効く」の線を跨がない |
| 表示範囲 | **常時**（grid でも content セクションでも） | ボタンの位置が動かない。オーバーレイ上端の Pinned 行（全件）とは選んだ数件だけ重複するが、位置の安定を採る |
| 保存先 | `~/.mulmoterminal/config.json` の **`toolbarPins`**（MulmoTerminal 固有） | ピン本体の `<workspace>/config/shortcuts.json` は MulmoClaude と**共有**で、両アプリのサーバがレコードを組み立て直す（`normalizeShortcuts`）。そこに足したフィールドは相手側の書き込みで落ちる |
| 値の形 | `["collection:works", "feed:news"]` の文字列配列 | 手で書くのが楽で、`kind` は enum なので最初の `:` で割れば曖昧さがない |
| ラベル / アイコン | **ピン側（shortcuts.json）から取る**。config は「どれを昇格させるか」だけを言う | 二重に持つとコレクション名を変えたときにツールバーだけ古い名前を出す |
| 消えたピンのキー | **消さない。描かないだけ**（枠も消費しない）。保存はクリックされたキーだけを足す / 外す | 片付けようとすると「このピンはもう無い」を古いかもしれない一覧から判断することになる。#1991 のレビューで P1/Major が 4 件出て、全部がその判断の間違え方だった。保存する配列の上限は 50（サニティ）で、描くのは 5 件 |
| 設定 UI | Settings に **Toolbar pins** タブ（appearance グループ、Grid header の次） | チェックリスト。既にピン留めしてあるものから選ぶだけなので編集フォームは要らない |
| 並び順 | config の配列順。UI は既存の順を保ったまま、新しくチェックしたものを**末尾に足す** | 手で並べ替えた順が、チェックを 1 つ足しただけで崩れない |

## 実装

### 新規

- `common/toolbarPins.ts` — 純粋関数のみ。`MAX_TOOLBAR_PINS`（描くボタン数 5）/
  `MAX_STORED_TOOLBAR_PINS`（ファイルの上限 50）/ `toolbarPinKey` / `sanitizeToolbarPins`
  （配列以外・壊れたキー・重複を落とす）/ `resolveToolbarPins`（キー列 → 実在するピン、先頭 5 件）/
  `nextToolbarPins`（クリックされたキーだけを足す / 外す。`live` は描ける件数を数えるためだけに読む）。
- `src/composables/toolbarPins.ts` — シングルトン ref + `setToolbarPins`（`toolbarPinsMark` と対で、
  保存を跨いだ古い読み込みを捨てる）+ `promoteToolbarPin`（intent を直列キューに載せ、実行時に解決）。
- `src/components/settings/ToolbarPinsSection.vue` — ピン一覧のチェックリスト。
- `test/common/toolbarPins.spec.ts`。

### 変更

- `server/config/app-config.ts` — `toolbarPins: string[]` を interface / 既定値 / load / update /
  `toPublicAppConfig` の 5 か所に足す。
- `src/composables/useAppConfig.ts` — `loadConfig` で `setToolbarPins(c.toolbarPins)`。
- `src/components/AppToolbar.vue` — 切り替えグループの右にピンのグループを描く。
  クリックは `browseGotoDetail(kind, slug)`、そのコレクションを見ている間は active。
- `src/components/settings/settingsTabs.ts` / `SettingsModal.vue` / `src/i18n/{en,ja}.ts` — 新タブ。
- `test/server/config/settings-coverage.spec.ts` — `REACHABLE_BY` に `{ ui: true, skill: CONFIG_SKILL }`。
- `test/src/components/AppToolbar.spec.ts` — ピンが出る / 出ない / 押すと飛ぶ。
- `docs/guide/{en,ja}/config.md` — Settings の表と全キー表、`mulmoterminal-config` skill。

## 確認すること

- ピンが 0 件のとき、ヘッダーが今までと 1px も変わらないこと（区切り線が残らない）。
- MulmoClaude 側でピンを外した項目がツールバーから消え、**ピンし直すと元の位置に戻る**こと
  （config のキーは消さない）。
- 上限（5）に達したとき、チェックできないことが見て分かること。

## やらないこと

- `shortcuts.json` のスキーマは触らない（MulmoClaude との共有契約）。
- ピンの**並べ替え UI** は作らない（MulmoClaude 側にはある）。ツールバーの並びは config の順。
