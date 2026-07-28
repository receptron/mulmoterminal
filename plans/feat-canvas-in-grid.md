# feat — grid の拡大セルでも Canvas を出す

grid のセルで走っているエージェントが `presentDocument` / `presentHtml` / `presentForm` /
`presentMulmoScript` を呼んでも、今は**どこにも出ない**。Canvas は single view 専用で、
`GuiPanel` はそこに 1 つだけマウントされている（`App.vue:389`）。

拡大中のセルの右に Canvas を出す。**single view の挙動は一切変えない。**

## 障害は UI ではなく、grid セルが GUI MCP を知らないこと

`GuiPanel` を置くだけでは永久に空になる。grid セルの claude は GUI MCP を渡されていない
（`ws-routes.ts:217` の `?gui=0` → `attachGuiMcp=false` → `claude-args.ts:46` を通らない）ので、
`presentDocument` という道具を知らない。

`attachGuiMcp` は 4 つの意味を兼ねている:

| # | 意味 | 参照 |
|---|---|---|
| 1 | GUI MCP + `--strict-mcp-config` + `--allowedTools` | `claude-args.ts:46` |
| 2 | Docker サンドボックスを走らせるか | `pty-spawn.ts:47` |
| 3 | dev terminal として記録（チャット一覧から除外・永続） | `ws-routes.ts:238` |
| 4 | `entry.active` の初期値 | `ws-routes.ts:283` |

**この変数の正体は `isSingleView`。** だから grid でこれを立てると、GUI MCP と一緒に
サンドボックスまで付いてくる（2）── grid セル全部が Docker の中で動き出す。

## 解 — GUI MCP を Claude Code 自身の per-folder MCP 設定に置く

**`attachGuiMcp` を触らない。** grid は今のまま `false`（`--mcp-config` を渡さない、
`--strict-mcp-config` を付けない、サンドボックスしない）。代わりに、GUI MCP を
**ユーザー側の MCP 設定から**接続させる。

Claude Code は MCP config の URL 内の `${VAR}` を**接続時に展開する**（実測で確認）:

```json
{"mcpServers":{"mulmoterminal-render":{
  "type":"http",
  "url":"http://127.0.0.1:${MULMOTERMINAL_PORT}/api/mcp/render/${MULMOTERMINAL_SESSION_ID}"}}}
```

MulmoTerminal は spawn 時の env を制御できるので、この 2 つを渡すだけでよい。**URL が
セッションごとに変わることは、静的な設定ファイルに置けない理由にならない。**

grid は `--strict-mcp-config` を付けないので、ユーザーの `.mcp.json` / `local` scope /
`user` scope がそのまま載る ── **フォルダごとの on/off は Claude Code の既存機構が全部やる。**

これで不要になるもの: `.mulmoterminal.json` の `gui` キー、設定 UI、per-dir config の
書き込みルート（"workspace がデータベース" の不変条件も無傷）、`writableDirConfigSchema` の
変更、スキーマ再生成、`mulmoterminal-config` SKILL.md の更新。

### 実測メモ

- `--mcp-config` にインラインで渡した `${MT_SESSION_ID}` は展開された（プローブサーバーに
  `POST /api/mcp/abc123` が届いた）
- `claude mcp add -s local` 経由でも展開された（`POST /api/mcp/localscope99`）
- **`claude mcp add` は保存時に `${}` を URL エンコードする**（`$%7BMT_SESSION_ID%7D`）。
  それでも展開は効くが、`claude mcp get` の表示が壊れて見えるので docs に一言要る

## URL をグループで分ける

`.mcp.json` が与えるのはサーバー単位の on/off だけ。ならば**サーバーを分ければ**ツールの
粒度が手に入る。

| グループ | URL | 中身 | 性質 | `--allowedTools` |
|---|---|---|---|---|
| **render** | `/api/mcp/render/:sessionId` | presentDocument・presentHtml・presentForm・presentChart | Canvas に描く。ただし presentDocument だけは fillImages を通す（有料生成） | **presentDocument 以外を自動許可** |
| **data** | `/api/mcp/data/:sessionId` | `manageCollection`・`manageAccounting` | workspace の構造化データを読み書き | プロンプト |
| **media** | `/api/mcp/media/:sessionId` | generate-image・mulmoscript | 生成が高価。ファイルを産む | プロンプト |
| **external** | `/api/mcp/external/:sessionId` | google・x | third-party のアカウント / API | プロンプト |
| *(既存)* | `/api/mcp/:sessionId` | 全部 | single view 用・後方互換 | **変更なし** |

**URL はユーザーの設定ファイルに書かれる＝実質的な公開 API。** 後から変えにくいので、
この 5 本を最初に決め切る。

`spawnBackgroundChat`（`HOST_TOOL_DEFINITIONS` の 3 つ目）は**どのグループにも入れない** ──
描画でもデータでも外部でもない制御系で、grid セルが別セッションを勝手に起こす必要は薄い。
全部入りの既存 URL でだけ使える。

### 実装は既存の継ぎ目に乗る

`mcp-routes.ts:25` はリクエストごとに `buildGuiMcpServer(sessionId, baseUrl, { submitTranslationTool })`
を作る ── **オプション引数が既にある**。`tool-gate.ts` の `offeredTools(isTranslationWorker,
plugins, workerTool)` は**プラグインのリストを受け取る**ので、絞り込みはそこ 1 箇所。

`tool-gate.ts` にはこの用途の前例がある。翻訳ワーカーは `submitTranslation` 1 つだけを提示され、
それ以外は*提示していなくても*拒否される:

> Two layers, because the first one is only a list and a model can name a tool it was not shown.

グループ絞り込みも同じ関数を通せば、**この 2 層の防御をそのまま継承できる**。「提示しない」
だけでは、モデルが名前を言い当てたときに素通りする。

ルートは `/api/mcp/:sessionId`（全部・現状のまま）と `/api/mcp/:group/:sessionId` の 2 本。
セグメント数で区別できる。

### グループ表は MulmoTerminal 側に置く — MulmoClaude に波及させない

| | 置き場所 | MulmoClaude への影響 |
|---|---|---|
| **A（採用）** | MulmoTerminal 内のマッピング表（`common/toolGroups.ts` を 1 枚） | **なし。** ローカル変更のみ |
| B | `ToolDefinition` に `group` を足し各プラグインが自己申告 | protocol + プラグイン 10 個の変更・bump・publish、MulmoClaude 側の取り込み |

B の方が設計としては綺麗（プラグイン自身が自分の性質を知っている）が、コストが釣り合わない。
共有パッケージを触ると両アプリの版ズレリスクが出る（同じ workspace データを触るので skew は
実データの不具合になり得る）うえ、**MulmoClaude はこの分類を使わない** ── チャット主体で全ツール
常時 on の設計なので subset する動機がない。払っても受け取る側がいない。

そもそもブローカーは別実装 ── MulmoTerminal は in-process の Streamable HTTP
（`server/mcp/broker.ts` + `mcp-routes.ts`）、MulmoClaude は stdio JSON-RPC
（`server/agent/mcp-server.ts`）。broker.ts のコメントどおり *"the same shape"* の別物なので、
URL 分割は構造的に波及しない。

A の代償は「プラグインを足したときに表の更新を忘れうる」こと。**未分類のツールはどのグループ
にも入らない**を既定にしておけば、忘れても安全側に倒れる。

## `--allowedTools` — on/off はユーザー、自動許可は MulmoTerminal

MulmoTerminal はユーザーが何を登録したか知らないが、**知る必要がない**。`render` グループの
完全修飾名（`mcp__mulmoterminal-render__*`）を常に `--allowedTools` に入れておけばよい ──
登録されていなければ無害、登録されていれば無確認で描画できる。他のグループは通常の許可
プロンプトが門番になる。

**on/off はユーザーが Claude Code で決め、何を無確認で走らせるかは MulmoTerminal が決める。**

サーバー名は `mcp__<サーバー名>__<tool>` の形で `--allowedTools` と結合しているので、**名前を
規約として固定する**こと。ユーザーが別名で登録すると自動許可が外れて毎回プロンプトになる。
UI から登録する導線（下記）を主経路にすれば、その事故は起きない。

### `claude-args.ts` の変更 — 単独で渡して問題ないことを実測済み

grid でも `--allowedTools` を出す必要がある。現状それは `attachGuiMcp` のブロック内にしかなく、
`--strict-mcp-config` と同時にしか渡されたことがない。単独時の挙動を実測した:

| | 条件 | 結果 |
|---|---|---|
| E | local scope に登録した MCP ツール、`--allowedTools` なし | **拒否**（`-p` なのでプロンプトが出せず deny） |
| F | 同じツール、`--allowedTools "mcp__probe__probePing"` のみ（`--mcp-config` も `--strict` もなし） | **無確認で実行された** |
| G | F と同じ条件で `Read` も併用 | **両方成功** ── `--allowedTools` は排他リストではない |
| B | `--allowedTools` に無関係な MCP ツール名だけを渡して `Read` | **成功** ── named 以外を締め出さない |

結論: **`--allowedTools` は「これだけ許す」ではなく「これは無確認でよい」の加算的な事前承認**で、
`--strict-mcp-config` なしの単独指定で正しく働き、ユーザー自身の local scope から来た MCP
サーバーのツールもこれで自動許可できる。**本 plan の前提どおり。**

`claude-args.ts` は冒頭コメントどおり「このフラグ集合を PTY なしで単体テストするため」の
純関数なので、差分は小さくテストも書ける。

## 有効化の導線

主経路は **grid で `+` を押した後の画面**（`TerminalCell.vue:1412` の `cell-launch`）に
「このフォルダで Canvas を有効にする」を置き、`claude mcp add -s local` 相当を実行する。

- `local` scope（`~/.claude.json` にパス単位）── **repo の外・承認不要・自分だけ**。既定はこれ
- `.mcp.json`（project scope）── repo 共有・承認ゲートあり。チームで使うなら

起動前の画面に置くのが要点。**spawn 時に確定するフラグなので、決めてから起動するという順序が
自然に守られる。** 発見の問題も、起動のたびに目に入るので解ける。

すでに走っているセルには後から効かない。`claude mcp list` の結果と実際のセッションが食い違う
場合に、セルヘッダに**「再起動で有効」バッジ**を出す。

## セッションが持っているツールを記録する

`ToolsPane` の per-session 表示、右ペインのトグル出し分け、未拡大 grid のチップが**すべて
「このセッションは何を持っているか」を見る**。`devTerminalSessions`（= grid セッション）はもう
その答えにならない（grid でも持つセルが出るので）。

resume されるセルも以前の状態を知る必要があるため、**セッションごとのツール集合を永続化する**
（`devTerminalSessions` が既にファイルに書き出されているので同じ扱い）。抜けるとリロードの
たびに Canvas の有無が揺れる。

## UI — 拡大時の右ペイン、3 択排他

拡大時のレイアウトは `[roster 360px | terminal | FilesPane]`（`listMode`）と strip モードの
2 形態があり、**`feat-910-phase1-files-pane.md` が敷いた row ラッパと `clampPaneWidth` を
そのまま流用する**。3 カラムで既に狭いので、**右枠は Files ⇄ Canvas ⇄ Tools の 3 択排他**
（roster は左に残す）。4 カラムは laptop で破綻する。

`GuiPanel` は既に `sessionId` でパラメータ化されているので、2 つ目のマウントはほぼ追加コスト
なし。`expandedUid` への追従は FilesPane が前例だが、**Canvas には未保存編集がないので無条件
追従でよい**（`paneUid` / `paneCwd` の「re-root を断られたら前のルートに留まる」分岐は不要）。

注意: 同一セッションに single と grid の両方が Canvas をマウントし得る。`GuiPanel` の
`persistOnly` エコー抑制（2 つ目のビューが view-state 更新をライブで受け取らない）がそこで
顔を出す。

**トグルは無条件に出さない。** 描画系を持たないセルで空の Canvas を見せるのが最悪:

- render グループを持って起動した → Files ⇄ Canvas ⇄ Tools の 3 択
- 持たずに起動した → Canvas のトグルを出さない（`ToolsPane` は出してよい ── そのセルが何を
  持っているかを read-only で示す面なので）

`ToolsPane` も今は single view 専用。末尾の **"Available tools are the same for every session;
load once" という前提は成り立たなくなる**ので直す（per-session 表示に。read-only は維持）。
名前と説明は `/api/tools`（`toolSummaries`）から取れる。

## 未拡大の grid — 合図だけ

セルの中に Canvas は置かない。2×2 でも狭く、3×3 では成立しない。そして grid の仕事は
**トリアージであって読むことではない**（読ませ始めると grid がダッシュボードに変質する）。

代わりに、**Canvas 出力が出たことを合図する**。今は出ても grid 側に痕跡がなく、拡大するまで
存在に気づけない ── 「見落とさないための道具」としては穴。

- ヘッダに未見チップを 1 つ（`◧ 3`）。model / context% / token / branch のチップと同じ語彙に
  乗せ、新しい UI 概念を持ち込まない
- 既存の状態色に**弱く**参加させる。**amber（要対応）に昇格させない** ── 出力があることは
  緊急ではなく、混ぜると amber の意味が薄まる。実装前に `notifyKinds.ts` と既存の agent state
  定義を見て既存概念に寄せる
- チップをクリック → そのセルを拡大 + Canvas を開いた状態で開く（ズームの FLIP は既存）

## やらないこと

- **single view の挙動変更いっさい。** 関連して調査中に見つけた事実を記録として残す ──
  サンドボックスは `MULMOTERMINAL_SANDBOX=1|true` の明示設定が必要で**既定 off**、かつ
  `darwin` 限定（Linux は明示的に gate off）。一方 `--strict-mcp-config` は `attachGuiMcp`
  （= single view か）に紐付いているので、**env を立てた macOS ユーザー以外の全員**にとって
  single view はサンドボックス無しで `--strict` だけが付き、そのプロジェクトの `.mcp.json` /
  local scope MCP が落ちている。意図的な隔離である可能性もあるため、本 plan では触らない
- grid セル内への Canvas 描画（トリアージ盤を壊す）
- MulmoTerminal 独自の per-dir `mcpServers`（Claude Code の 3 scope に任せる）
- グローバル `userMcpServers` の stdio 対応（HTTP のみのまま。stdio が要るなら `claude mcp add`）
- `ToolDefinition` への `group` フィールド追加（MulmoClaude への波及を避ける。A を採用）

## 検証状況

`--allowedTools` の単独指定は実測済み（上記 E–G / B）。実装後、走らせたサーバーに対して確認:

| | 結果 |
|---|---|
| `/api/mcp/render/:id` の `tools/list` | `presentDocument presentForm presentChart presentHtml` |
| `/api/mcp/data/:id` | `presentCollection manageAccounting manageCollection` |
| `/api/mcp/media/:id` | `generateImage presentMulmoScript` |
| `/api/mcp/external/:id` | `google readXPost searchX` |
| `/api/mcp/:id`（既存 URL） | 13 個すべて。**無傷** |
| 未知のグループ | 404 |
| render URL で `manageCollection` を `tools/call` | 拒否（2 層目が効いている） |
| render URL で `spawnBackgroundChat` | 拒否 |
| `/api/tools?sessionId=` | 学習済みグループのぶんだけ返し、未分類の `spawnBackgroundChat` を除外 |
| `~/.mulmoterminal/session-tool-groups.json` | `<id> <group>` が 1 行ずつ追記される |

**まだ実機で見ていないもの:** MulmoTerminal が実際に起こした grid セル（tmux 経由の PTY）で
`${MULMOTERMINAL_PORT}` / `${MULMOTERMINAL_SESSION_ID}` の展開が効くか。CLI 直叩きでは確認済み
だが spawn 経路が違う ── ブラウザでセルを 1 つ起こせば確定する。
