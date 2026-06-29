# feat: グリッドのスクリプトランナー（script.json → 空き端末で実行）

## 背景 / User Prompt

> mulmoterminal で、すべての作業をしたい。今は claude code が直接起動するけど、空いているところで unit test やサーバの起動 (`yarn run serve` or `yarn dev`) などを動かしたい。使えるスクリプトは `script.json` などで置いておいて、メニューから選択したら空いているターミナルで起動すれば良いかな？
>
> （方針確認の結果）
> - スクリプト取得元: **専用 `script.json` のみ**
> - 起動 UI: **各セルのランチャ（ディレクトリ選択画面）に「run a script」を出す＝ディレクトリ（セル）ごと**
>   - 当初はグローバルメニュー案だったが、「ターミナル＝ディレクトリ単位」というレビュー指摘を受け、**セルが選んだ dir の `script.json` を読み、その dir で実行**する方式に変更。
> - コマンド端末の寿命: **グリッド限定・揮発**（プロセスは復帰不能、リロードで消える、セッション一覧には出さない）
> - ベース: **PR #82（グリッド自動レイアウト）取り込み済みの main**

## 設計概要

claude セッションとは別に、任意コマンドを PTY で起動する経路を追加する。コマンド端末は
session / hook / transcript / reap の機構には乗せず、`/ws/run` という独立した軽量経路で
入出力だけを中継する（xterm 描画・入力・resize は `Terminal.vue` を流用）。

PR #82 でグリッドは「占有数からレイアウトを自動導出」になったため、「空きが無ければ拡張」の
ロジックは不要。`runScript()` は **コマンドセルを 1 つ占有として追加するだけ**で、`cellCount` が
自動で広がる（上限 9 はそのまま流用）。

### `script.json` 形式

ワークスペース直下（サーバの `CLAUDE_CWD`）に置く:

```json
{
  "scripts": [
    { "label": "Dev server", "command": "yarn dev" },
    { "label": "Unit tests", "command": "yarn test" },
    { "label": "Build",      "command": "yarn build" },
    { "label": "Sub server", "command": "yarn serve", "cwd": "packages/server" }
  ]
}
```

- `label`（必須）= メニュー表示、`command`（必須）= シェルで実行
- `cwd`（任意）= script.json からの相対 or 絶対。省略時はワークスペース直下
- **セキュリティ**: ブラウザは生コマンドではなく**配列の index** を送り、サーバが
  `script.json`（許可リスト）を読み直してコマンドを解決。`/ws` と同じ localhost origin チェックを適用

## 変更点

### サーバ (`server/`)
- **`scripts.ts`（新規・純粋関数, テスト対象）**
  - `loadScripts(workspaceDir): ScriptDef[]` — `<workspaceDir>/script.json` を読み込み・検証（欠落/不正/未存在は `[]`）
  - `resolveScript(workspaceDir, index): { command, cwd } | null` — index 解決＋ cwd を絶対化し存在確認
- **`index.ts`**
  - `GET /api/scripts?cwd=<dir>` — `<dir>/script.json` の scripts 一覧（`{ cwd, scripts:[{ index, label, command, cwd? }] }`）。cwd は `resolveWorkspace` で検証
  - `spawnCommandPty(command, cwd, ws)` — `pty.spawn(shell, ["-lc", command])`（win は powershell `-Command`）。
    `onData→output` / `onExit→exit` を中継。**ws close で即 kill**（揮発・再接続なし）
  - `/ws/run?index=N&cwd=<dir>` upgrade ブランチ（origin チェック）→ `<dir>` で index 解決 → `spawnCommandPty`

### フロント (`src/`)
- **`wsUrl.ts`**: `buildRunWsUrl({ host, secure, index, cwd })`（純粋・テスト対象）
- **`Terminal.vue`**: `command` prop 追加。あれば URL を `/ws/run`（`cwd` 同梱）に切替え、**自動再接続を抑止**、終了で `exit` emit
- **`CommandCell.vue`（新規）**: コマンド端末用の薄いセル。ヘッダ `dir` + `▶ ラベル`・拡大・✕、終了後「再実行」（connectKey++）。`command.cwd` で実行
- **`TerminalCell.vue`**: 空きセルのランチャに **「run a script」**行を追加。`/api/scripts?cwd=<dirInput>` を取得（resume と同じ debounce）、選択で `run {index,label,cwd}` を emit
- **`TerminalGrid.vue`**: `Slot.command?: {index,label,cwd}` 追加。占有判定を `session!==null || command!=null` に拡張
  （`occupiedCount` / `compact` / `add-state.canAdd` / zoom 判定を統一）。セルの `run` を受けて `onRun(uid,cmd)` でそのスロットをコマンド化。command は localStorage に保存しない（揮発）
- **`GridView.vue`**: グローバル Run メニューは設けない（#82 のツールバーのまま）

### テスト
- `server/scripts.spec.ts`: 正常・欠落・不正 JSON・型違い・空・index 境界・cwd 相対/絶対/不存在
- `src/components/wsUrl.spec.ts`: `buildRunWsUrl` 追加
- `src/components/CommandCell.spec.ts`: 起動 URL / 終了→再実行
- `src/components/TerminalGrid.spec.ts`: command 占有でレイアウト拡張・compact・揮発（非永続）

### ドキュメント
- `README.md`: 「Scripts / 実行メニュー」節と `script.json` 形式

## 確認ポイント（PR レビュー観点）
- `script.json` の場所 = ワークスペース直下（CLAUDE_CWD）
- コマンド端末は揮発（リロードで消える）・セッション一覧に出さない
- 生コマンドはブラウザから渡さず index で許可リスト解決
