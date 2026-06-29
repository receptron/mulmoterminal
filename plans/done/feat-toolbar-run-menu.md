# feat: ターミナルヘッダーに ▶ Run プルダウン（開いているプロジェクトの script）

Issue: #97

## 背景 / 現状
- `script.json` の Run は「空きセルのランチャー」内にしか出ず、走っているセルからは起動できない。
- script は **開いているプロジェクトに紐づく**べき（その端末の cwd の `script.json`）。デフォルトワークスペース（`CLAUDE_CWD`）ではない。

## ゴール
単一ビューの**ターミナルヘッダー**（「Terminal connected」の隣）に **▶ Run ▾** を置き、**開いているプロジェクトの `script.json`** を一覧。選ぶとグリッドに切替えて**空きセル**でそのコマンドを起動する。

## 設計

### `RunMenu.vue`（再利用ドロップダウン）
- props `cwd` の `/api/scripts` を**マウント時／cwd変化時に先読み**し、件数で表示判定。**スクリプト0件（script.json 無し）ならボタン自体を出さない**。選択で `run { index, label, cwd }`（解決後 cwd）を emit。外側クリック / Esc で閉じる。
- 設置: 単一ビュー（App.vue）＋グリッド各セル（TerminalCell）の端末ヘッダー。グリッドでは走っているセッションを潰さないため、選択は **別イベント `runSpare`** で空きセル起動（ランチャーの `run`＝このセルで起動 とは区別）。

### `Terminal.vue`
- `serverCwd` ref: 接続時にサーバ解決済み cwd（= 開いているプロジェクト）を保持。
- prop `runMenu`（単一ビューのみ true）でヘッダーに `<RunMenu :cwd="serverCwd">` を表示。
- `run` イベントを親へ re-emit。

### `usePendingScript.ts`（単一ビュー → グリッドの受け渡し）
- command cell はグリッドにしか存在しないため、選択を ref に stash → グリッドが mount 時に取り出して実行。
- `requestRun(cmd)` / `takePending()`（取り出して clear）。

### `App.vue`（単一ビュー）
- `<TerminalView run-menu @run="onRunScript">`。
- `onRunScript(cmd)` → `requestRun(cmd)` ＋ `viewMode = 'grid'`。

### `GridView.vue`
- ツールバーの RunMenu は撤去（配置をヘッダーへ移動）。
- onMounted で `takePending()` → あれば `runScriptInNewCell(state, cmd)`。

### `gridTabs.ts`
- `runScriptInNewCell(state, command)`: 末尾の空きランチャー再利用 or 新規 command cell を append（上限厳守）→ 最終ページへ。

## テスト
- `gridTabs.spec.ts`: `runScriptInNewCell`（append / 空きランチャー再利用 / 上限 no-op / ページ遷移）
- `RunMenu.spec.ts`: 開く→一覧→選択で emit / 空表示 / 外側クリックで閉じる
- `usePendingScript.spec.ts`: 受け渡し・1回で消費・最新優先

## 確認ゲート
`yarn format` / `lint` / `typecheck` / `build` / `test`。UI実機（単一ビューのヘッダー ▶Run → 開いているプロジェクトの script 一覧 → 選択でグリッドに切替＆空きセル起動）は手元で目視確認。
