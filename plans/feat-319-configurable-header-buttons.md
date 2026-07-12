# feat #319 — config 駆動・拡張可能なヘッダーアクションボタン

Umbrella #241 の子。ヘッダーのアクションボタンを完全に config 駆動にし、
新アクション（新セル / PR / ファイル操作）と「隣接挿入」を追加する。

## 問題

ヘッダーのアクションボタンは config 駆動（`~/.mulmoterminal/config.json` +
`.mulmoterminal.json` の `buttons` → `server/header-config.ts` → `GET /api/header` →
`Terminal.vue` の `v-for="b in headerButtons"`）だが、

- 📎 Insert a file path / 📁 file explorer が `Terminal.vue` にハードコードされ、
  config では削除・並べ替えできない（config `buttons` は built-in への“追加”）。
- `open` は `url / reveal / files / view` のみ。「ターミナルを開く」「PR を開く」が無い。
- サーバに既定 `buttons` 定義が無い。

## 決定事項（確認済み）

1. 「cwd でターミナルを開く」= **mulmoterminal 内に新セルを開き、即座に OS 既定シェル `$SHELL` を起動**
   （ランチャーフォームは出さない。`process.env.SHELL || "/bin/sh"`）。
2. built-in を **config 駆動デフォルト化**（未設定→既定、設定→置換/削除/並べ替え）。
3. 「PR を開く」= **このブランチの既存 PR がある時だけ**表示（無ければ非表示）。
4. **新セルは発火元セルの隣（右）に挿入**。**Run ボタンの新セルも同挙動**。

## 設計

### スキーマ — `server/config-schema.ts`

`open` の `OpenTarget` に排他ターゲットを追加（`url/reveal/files/view` と同じ union 拡張）：

- `terminal: string` — 新セルを開く dir（`${dir}` 展開）。
- `pr: true` — 現在ブランチの PR を開く（bool 定数）。
- `pickFile: true` — OS ダイアログでパスを選びセッションへ挿入。

`files`（アプリ内エクスプローラ）は既存のまま。`view` も既存。

### 既定 buttons + 解決 — `server/header-config.ts`

- `DEFAULT_BUTTONS`：built-in を config エントリで表現。
  - `{ id:"pick-file", icon:"attach_file", label:"Insert a file path", run:"open", open:{pickFile:true} }`
  - `{ id:"files", icon:"folder_open", label:"Open the file explorer", run:"open", open:{files:"${dir}"} }`
- `buttons` 未設定（キー無し/null）→ `DEFAULT_BUTTONS`。`[]`→ボタン無し。`[...]`→そのまま。
  （chips の `null=未設定` と同じ扱い。ユーザ config の現状 `buttons: []` は本 PR で実 list に更新。）
- **PR 解決**：`open.pr` を持つボタンは resolver が現在ブランチの PR URL を解決：
  `gh pr list --head <branch> --repo <repo> --state open --json url`（`server/prs.ts` の runGh 流用、
  `repo+branch` キーで短 TTL キャッシュ）。URL 有→ `open:{url: prUrl}` に書換、無→ボタンを落とす。
  branch/repo は既存の git 解決（header context の cwd）から取得。

### クライアント — `Terminal.vue` / `useHeaderAction.ts` / grid

- `Terminal.vue`：ハードコードの 📎/📁 を撤去し、解決済み `headerButtons` のみ描画
  （voice は capability トグルなので据え置き）。発火元セル識別のため `slotKey`（=`cell-<uid>`）を action に渡す。
- `useHeaderAction.ts` の `dispatchOpen` に追加：
  - `open.pickFile` → 既存 pickFile ロジック（`/api/pick-file` → `submitText`）を移設して呼ぶ。
  - `open.terminal` → 新シングルトン composable `useNewTerminal`（`useFilesView` 同型）で
    `openShellTerminalAt({ cwd, afterSlotKey })`。
- **既定シェルセル（新 cell kind）** — server + client：
  - server：`/ws/launch` に `shell=1` を追加（config インデックス非依存）。受けたら
    `spawnLauncherPty(sessionId, ws, process.env.SHELL || "/bin/sh", cwd)` で **`$SHELL` を起動**
    （既存の persistent/reattach/tmux 経路をそのまま流用）。
  - client：`Cell` に既定シェルを表す印（例：`launcher: { index: -1, label: "shell" }` か `shell: true`）。
    `buildLaunchWsUrl` に `shell` を通し、reattach も同経路。
- **隣接挿入** — `src/components/gridTabs.ts`：
  - `insertCellAfter(state, afterUid, cell)` を追加（`afterUid` の直後にセルを挿入）。
  - 「🖥」→ 直後に**既定シェルセル**を cwd 付きで挿入（即 launch）。
  - `runScriptInNewCell` を隣接挿入に変更（`afterUid` を受ける）。
  - `runSpare` 発火に発火元 `uid` を付与（`TerminalCell` は `props.uid` を保持）。
  - `GridView` が `useNewTerminal` を購読し `insertCellAfter` で新セルを開く。

### ユーザ config

`~/.mulmoterminal/config.json` の `buttons` を「既定 − 📁 ＋ 🖥 ＋ 🔗」に：

```json
"buttons": [
  { "id":"pick-file", "icon":"attach_file", "label":"Insert a file path", "run":"open", "open":{ "pickFile": true } },
  { "id":"terminal", "emoji":"🖥", "label":"New terminal here", "run":"open", "open":{ "terminal":"${dir}" } },
  { "id":"pr", "emoji":"🔗", "label":"Open this branch's PR", "run":"open", "open":{ "pr": true }, "when":"isGitRepo" }
]
```

## ファイル

- `server/config-schema.ts` — open ターゲット `terminal/pr/pickFile` 追加。
- `server/header-config.ts` — `DEFAULT_BUTTONS`、未設定→既定、PR 解決 + キャッシュ。
- `server/prs.ts`（または新 `server/pr-for-branch.ts`）— `gh pr list --head` で branch→PR URL。
- `src/composables/useHeaderButtons.ts` — `OpenTarget` に新フィールド。
- `src/composables/useHeaderAction.ts` — `pickFile/terminal` dispatch。
- `src/composables/useNewTerminal.ts`（新）— 新セル要求のシングルトン。
- `src/components/Terminal.vue` — ハードコードボタン撤去、slotKey 受け渡し。
- `src/components/gridTabs.ts` — `insertCellAfter`、`runScriptInNewCell` 隣接化。
- `src/components/{GridView,TerminalGrid,TerminalCell}.vue` — uid 配線、`useNewTerminal` 購読。
- テスト：`server/header-config.spec.ts`（既定/置換/PR解決モック）、`server/config-schema.spec.ts`、
  `src/components/gridTabs.spec.ts`（隣接挿入）、`useHeaderAction` dispatch。
- `README.md` — 新 open アクション（terminal/pr/pickFile）、既定 buttons、隣接挿入を記載。

## 非スコープ（後回し）

- OS ターミナル（Terminal.app）起動アクション（今回は mulmoterminal 内セルで `$SHELL`）。
- 起動シェルの選択 UI（今回は `$SHELL` 固定。将来 config 化可）。
- PR 解決の詳細キャッシュ無効化（短 TTL のみ。マージ直後の反映遅延は許容）。
