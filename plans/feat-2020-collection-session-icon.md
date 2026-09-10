# コレクション発のセッションに、そのコレクションのアイコンを出す (#2020)

## 何が欲しいか

コレクションから開いたチャットのセルを見て「どのコレクションの用で開いたか」が分かること。
いまセル header にあるのは `DirIcon`（プロジェクトの favicon）だけで、コレクション発のセッションは
cwd がワークスペースなので **全部おなじ絵**になる。グリッドに複数並ぶと読めない。

## なぜ `DirIcon` の仕組みに乗らないか（issue の整理をそのまま採る）

- `DirIcon` の `src` は `/api/dir-config?cwd=…` 由来。**cwd 単位**の値で、セッション単位の値を持てない。
- コレクションの `schema.icon` は画像ではなく **Material Symbols 名か絵文字1つ**。`<img>` に載らない。

## 採る案: サーバに記録（issue の案 B）

案 A（クライアントの localStorage を逆引き）は「そのブラウザだけ」で、リロード後の別タブ・別端末で
消える。セッションの属性はセッションと同じ寿命であるべきなので、サーバに持たせる。

### 層ごとの変更

1. **ワイヤ** — `POST /api/plugin/spawnBackgroundChat` が `collection`（slug）を受ける。
   `parseBackgroundChat` が `isSafeSlug`（`@mulmoclaude/core/collection`）で形だけ検査する。
   形が通っただけでは記録しない — 実在するコレクションかどうかは次の層が決める。

2. **解決 + 保存** — `server/session/session-collections.ts`（append-log の行の形）＋
   `registry.ts`（map / hydration / 追記）。`session-memos.ts` / `custom-agent-log.ts` と同じ
   append-log（`~/.mulmoterminal/session-collections.jsonl`、同じ id の最後の行が勝つ）。
   slug から `{ icon, title }` はサーバが `loadCollection(slug, projectScopeForCwd(cwd))` + `toSummary`
   で **spawn 時に一度だけ**解決する。存在しなければ何も記録しない（`/deep-research` のような
   コレクションでない slash command はここで落ちる）。

   - **書き込みはインスタンス間で安全だが、読みはライブではない**: 各プロセスは起動時に一度だけ
     fold して以降はメモリから答えるので、2つ目のサーバが立てたチャットは1つ目が再起動するまで
     マークが付かない。意図的 — 読み口の `/api/session/:id` は cockpit roster が**セルごとに4秒
     おき**に叩くので、ここで再読み込みすると全グリッドの全セルが永久にファイル全体を fold する
     ことになる。refresh を持つ `refreshAgentConversations` は occupancy check（worktree が空いて
     いるかの判定）が一度だけ呼ぶもので、描画のたびに呼ぶものではない。`sessionMemos` は同じ
     ルートで同じ one-shot hydration（ユーザが打った文なのに）なので、グリフならなおさら許容する
     （Codex round 5 の P2 に対する反論。Codex 同意済み）。

   - **スナップショットで良い理由**: セッションは歴史的な事実で、「どのコレクションの用に開いたか」は
     あとから変わらない。あとで icon を引き直すには毎リクエスト collection の discovery が要る
     （`/api/session/:id` はセルごとに叩かれる）ので、値段に見合わない。schema の icon を変えても
     過去のセッションは古いグリフのまま — それは受け入れる。
   - **spawn の応答前に await するのは「解決」と「メモリ上の記録」まで**: クライアントはセルを
     置いた直後に `/api/session/:id` を一度だけ読む（`loadInitial`）。記録が遅れて着くと、その
     セルは次のターンが終わるまでアイコンが出ない。`groupsForSpawn` と `Promise.all` で並列にして待つ。
   - **ディスクへの append は意図的に await しない**。`registry.ts` の appender 10 本のうち
     await するのは `setSessionMemo` 1本だけで、その docblock が線引きを書いている
     （「ユーザが打った文で復元できないもの」は await、「サーバが導出できるもの」はしない）。
     ここは後者。append が落ちても失うのは**再起動後のグリフ**だけで、プロセスが生きている間は
     メモリ上の map が答える。失敗を呼び出し側に返しても spawn を失敗させる気は無いので、
     await は「rejection を握りつぶす遅い fire-and-forget」にしかならない
     （Codex round 1 の P2 に対する反論。Codex 同意済み）。

3. **一覧** — `/api/session/:id` の応答に `collection: { slug, icon, title } | null` を足す。
   これ**一本**でセル header と cockpit roster の両方が賄える（roster も同じ endpoint を叩いている）。
   `sessionDetailView` には入れない — あれは `/clear` の precedence 専用の純関数で、
   `workPhase` と同じくルート側で足す。

4. **UI** — `@mulmoclaude/core/plugin-vue` の `IconGlyph` で描く。
   （ligature 名も絵文字も同じ口で描け、名前でない値がテキストとして溢れるのを止めてくれる。
   core 側の "Never inline `<span class=material-symbols-outlined>{{ icon }}</span>`" はこの為。）
   - `TerminalCell.vue` row 1（tiled / expanded）: **ステータスドットの直後**。`DirIcon` は残す —
     プロジェクトとコレクションは別の問いで、差し替えると「どの cwd か」が読めなくなる。
   - `CockpitHeader.vue`: 同じ位置。roster 行と filmstrip サムネの両方がこれを使う。
   - roster 行はセル自身ではないので `SessionMetaView` → `CockpitRow` を経由する。

### 三つの view mode（docs/grid-view-modes.md）

- tiled grid / expanded → `TerminalCell.vue` の row 1
- cockpit roster → `TerminalGrid.vue` の roster 行 → `CockpitHeader`
- filmstrip → `TerminalCell.vue` の `<CockpitHeader v-if="filmstrip">`

三面とも同じ props を通るので、抜けはコンパイルで落ちる。

## slug をどこから取るか（クライアント）

`startCollectionChat` で、この順:

1. `parseCollectionSlashSeed(message)?.slug` — action / starter / custom view のボタンが作る
   seed prompt は `/slug …` で始まる。**browse overlay が閉じていても効く**ので、issue が案 A の
   限界に挙げた経路をここで拾える。
2. `currentCollectionSlug()` — いま開いているコレクション詳細（feed は除く）。

どちらもサーバが実在確認するので、`/deep-research` のような slash command が紛れ込んでも
記録されない。**feed も同様に落とす** — `loadCollection` は feed にも答える（実測:
`loadCollection("hacker-news")` は `source: "feed"` を返す）ので、resolver が
「コレクションである source（`user` / `project`）」だけを通す。禁止リスト（`!== "feed"`）ではなく
許可リストなのは、上流が source を増やしたときに「マークが付かない」側に倒れるようにするため。
これを入れないと、feed をブラウズして押すと付かないのに `/hacker-news …` の seed では付く、という
PR 内部での食い違いになる（Codex round 3）。

## 届かない経路（既知の限界）

plugin の `startChat(prompt)` capability は **prompt しか運ばない**ので、ビューが独自の散文で
呼ぶと slug がホストに届かない（`collectionUi.ts`）。全画面 browse overlay はルートが答えるので
問題ないが、**ルートを持たない2つの surface** は答えられない:

- **セル横の Collections ペイン**は自分のコレクションを知っている（`routeSlug()` を持つ nav
  surface を登録している）が、この関数は聞いていない。ただし配線は見た目ほど単純ではない —
  `activeCollectionNavSurface()` は scope 専用 surface を**貫通して**下の nav を返す仕様なので、
  ペインの上に Canvas カードが開いていると **ペインのコレクションでマークしてしまう**。
  「付かない」より悪い「間違って付く」になる。navigation が欲しい意味論とは別の accessor が要る。
- **Canvas カード**は本当に答えられない。canvas が navigation を取るとカード内のリンクを飲み込んで
  しまうので、意図的に scope 専用 surface として登録されている。

どちらもこの PR では塞がない。失うのは**マークが出ないこと**だけで、間違ったマークが出ることは
ない（CI の codex-review が round 7 で指摘、ペイン側は Codex が round 8 で追加指摘）。

## 入れないもの（意図的に）

- **`/api/sessions` の行**: セッションサイドバーは #1201 / #1202 で無くなっていて、いまの
  `/api/sessions` は favicon（`useSessions`）しか読んでいない。足しても誰も描かない。
- **定時タスク（`spawnScheduledChat`）/ hidden worker**: store はルートに縛られていないので口は
  開いているが、hidden な worker はセルを持たないので描く面が無い。
- **toolbar の Collections バッジの削除**: issue のコメントで「要否は任せる」とある。セルを持てない
  チャット（グリッドが満杯で `placeSpawnedChat` が失敗し `dropCollectionChat` された場合）は
  アイコンでは表せないので、バッジはそのまま残す。ただし `AppToolbar.vue` のテンプレート側コメントが
  `it is not a grid cell` と書いていて 110 行目の `They ARE grid cells` と食い違っているので、
  そこだけ直す。
- **グリフを押せるようにする（そのコレクションを開く）**: issue は「見て分かること」だけを求めている。

## テスト

- `test/server/session/session-collections.spec.ts` — 行の round trip、壊れた行の拒否。
- `test/common/sessionCollection.spec.ts` — ワイヤ形の type guard（両側が決める形なので `common/`）。
- `test/src/composables/useChatLauncher.spec.ts` — seed prompt から / browse route から slug が乗ること、
  乗らない場合に送らないこと。
- `test/server/session/background-chat.spec.ts`（既存があれば拡張）— `collection` の parse。
- roster の merge（`rosterPhase.ts`）— 既存 spec に追加。

## 実装後: 実機で確認したこと（2026-09-10）

`PORT=34599` で dev backend を上げ、**この機械の本物のコレクション**に対して spawn ルートを叩いた。

- `menu_book`（ligature 名）と `📷`（絵文字）— 実在する2つのコレクションの `icon` がそのまま
  `/api/session/:id` の `collection` に載って返る。
- `/deep-research`（skill であってコレクションではない）は `collection: null`。
  `~/.mulmoterminal/session-collections.jsonl` にも行が増えない。
- backend を落として上げ直しても両方の記録が返る（append-log の hydration）。
- 確認に使った hidden セッションは `terminate` 済み。

**確認できていないこと**: 実ブラウザで生きたセルにマークが出ている画（このチェックアウトに
Playwright が無く、依存を足していない）。描画側は `CockpitHeader.spec.ts` /
`TerminalCell.spec.ts` が本物のコンポーネントを mount して glyph と title を検証している。

## 付随して切り出したもの

`GridView.vue` が `max-lines`（600、コメント・空行除く）の上限ちょうどにいて、`collection` を1行
足したら 601 で落ちた。行数を削るためではなく置き場所として正しいので、`rosterRow` /
`fallbackLabel` / `RowChrome` を `src/components/rosterRow.ts` に出した（隣の `rosterAgent.ts` と同じ形）。
挙動保存は **旧コードを逐語コピーした使い捨て harness で生成入力 5000 件を突き合わせて全一致**を
確認してから、generator と property を `test/src/components/rosterRow.spec.ts` に残して harness は捨てた。
