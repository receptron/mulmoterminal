# feat: presentDocument / presentHtml の相対パスをセッションの cwd 基準にする

対象: `server/backends/openPath.ts`, `server/mcp/broker.ts`, `server/infra/plugins-registry.ts`

## 問題

`presentDocument({ path })` / `presentHtml({ path })` の**相対パスは常に `CLAUDE_CWD`
（既定 `~/mulmoclaude`）基準で解決される**。セルごとに任意のプロジェクトディレクトリで
起動できる MulmoTerminal では、これはほぼ常に「エージェントが見ているディレクトリ」と
一致しない。

`~/git/ai/mulmoterminal` で走っているセッションが `presentDocument({ path: "README.md" })`
を呼ぶと、開かれるのは `~/mulmoclaude/README.md`。存在しなければ
`No markdown file exists at README.md` になり、**存在した場合は別プロジェクトのファイルを
黙って開いて、ユーザーの編集がそちらへ書き戻される**。後者が実害。

現状エージェントが確実に正しいファイルを開く方法は絶対パスを渡すことだけだが、ツールの
prompt は `docs/design.md` のような相対パスを推奨しているので、そうはならない。

## 現状の解決経路（確認済み）

| レイヤ | 実装 | root |
|---|---|---|
| ツール呼び出しの検証・読み書き | `openPath.ts` の `createByPathFileOps({ rootFor })` | `CLAUDE_CWD` |
| View の dispatch (`loadDoc`/`saveDoc`/`loadHtml`/`saveHtml`) | 同上の FileOps | `CLAUDE_CWD` |
| iframe への配信 `/htmlfile/ws/…` | `resolveHtmlFileRequestPath(await workspaceReal(), …)` | `CLAUDE_CWD` |

root の注入点は `@mulmoclaude/core/files` が `ByPathOptions.rootFor` として最初から
切っている拡張点なので、**core / plugin 側の変更は不要**。ホスト側の話。

なお `.` / `..` セグメントは core の `classifyFilePath` が一律で弾く（`./README.md` も
不可）。これは root を変えても変わらない。共有ルールなので本 plan では触らない。

## 方針：境界で絶対パスに正規化する（案A）

`/api/plugin/:toolName` に**入った時点で** `path` を絶対パスへ書き換え、以降は
セッション文脈なしで完結させる。

```
broker (sessionId を持つ)
  └─ POST /api/plugin/presentDocument  + X-MulmoTerminal-Session: <id>
       └─ 前段ミドルウェア: args.path が相対なら path.resolve(cwdOf(id), args.path)
            └─ 既存の execute（root は CLAUDE_CWD のまま、絶対パスなのでそのまま通る）
                 └─ ToolResult.data.filePath = 絶対パス
                      └─ View → htmlFileUrl → /htmlfile/abs/… / dispatch も絶対パス
```

利点は、**セッション文脈を必要とするのが「ツール呼び出しの 1 ホップ」だけ**になること。
View → dispatch も iframe の URL もブラウザから来るので session id を持たない。ここを
絶対パスにしておけば、その 2 経路は今のままで正しく解決される。保存済みの過去の
tool result（相対パスのまま）も、`CLAUDE_CWD` 基準という従来の意味で解決され続ける。

### 却下：`rootFor` を per-request にする（案B）

`AsyncLocalStorage` で `rootFor()` をリクエストごとに差し替える案。ツール呼び出しの
ホップは通るが、その後の View の dispatch と `/htmlfile/ws/…` はブラウザ発なので
セッションを名乗れず、`CLAUDE_CWD` に落ちる。**ツール呼び出しは成功してビューは開くのに、
編集の保存だけ別ファイルに書く / iframe だけ 404** という最悪の壊れ方をする。
session id を View と iframe URL の両方に通せば直せるが、それは案A より広い変更。

## `artifacts/` は cwd 基準にしない

`artifacts/html/…` は plugin 側で `isHtmlArtifactPath` により `files.artifacts`
（`CLAUDE_CWD/artifacts` 固定）へ振り分けられる。`artifacts/documents/…` も
`saveNewDoc` が書く場所なので同じ。**先頭セグメントが `artifacts` のパスは書き換えない**
— これを忘れると、自分が保存した直後のドキュメントを自分で開けなくなる。

プロジェクト側にも `artifacts/` がある場合は曖昧になるが、「`artifacts/` は
MulmoTerminal のワークスペース」で一貫させる。ツールの prompt にもそう書く。

## セッションの cwd をどう引くか

`server/session/registry.ts` に揃っている:

- 生きている PTY: `ptys.get(id)?.cwd`（実際に走っているディレクトリ。こちらが真）
- それ以外: `sessionCwd(id)`（`dev-terminal-cwds.json` から復元）
- どちらも無い: `CLAUDE_CWD`（今の挙動＝フォールバック）

ヘッダが無いリクエスト（スケジュール実行、feeds、リモート、既存の直叩き）も
`CLAUDE_CWD` にフォールバックする。既存経路の挙動は変わらない。

## やること

1. `server/mcp/broker.ts` — `postJson(.../api/plugin/<name>)` に
   `X-MulmoTerminal-Session: <sessionId>` を付ける。`postJson` がヘッダを取れない場合は
   引数を足す（他の呼び出し側に影響しない形で）
2. `server/session/session-resolve.ts`（もしくは registry の隣）に
   `cwdForSession(id: string | undefined): string` を追加 — 上の 3 段フォールバック。
   純関数として切り出してテスト可能にする
3. 新規 `server/backends/presentPathRoot.ts` —
   `absolutizePresentPath(args, cwd): args` を実装
   - `path` が文字列でない / 空 → そのまま
   - `classifyFilePath` 相当のゲートを通らない → そのまま（既存の検証にエラーを出させる。
     ここで独自判定を足すと core と二重実装になる）
   - 絶対パス → そのまま
   - 先頭セグメントが `artifacts` → そのまま
   - それ以外 → `path.resolve(cwd, value)`
4. `server/index.ts` — `mountAllRoutes` の**前**に `presentDocument` / `presentHtml` 用の
   前段ミドルウェアを登録して `req.body` を書き換える。`mountHtmlDispatchRoute` と同じ
   登録順の作法に従う（`kind` 付き＝View の dispatch は既に絶対パスなので素通りする）
5. `server/backends/openPath.ts` — 変更なし。コメントに「相対は境界で絶対化済み」旨を
   1 行足して、次に読む人が per-request root を再発明しないようにする
6. ツール prompt / ドキュメント — 下記「未解決」参照

## 副作用

`saveDoc` の `publishFileChange(rel)` は絶対パスだと mtime の stat に失敗し、
`[file-change] stat failed` を 1 行吐いて `Date.now()` にフォールバックする
（`backends/markdown.ts` に既述）。チャンネル名は一致するのでライブリフレッシュ自体は
効く。今回の変更で「相対で渡したケース」も絶対パスになるため、この行が出る頻度が上がる。
実害は無いが、core の publisher に絶対パスを教えるのが本筋の直し（MulmoClaude 側の判断）。

もう一つ、ツール結果とビューのタイトルに絶対パスが出るようになり、表示が冗長になる。
気になるなら表示側で cwd 相対に畳むが、本 plan の範囲外とする。

## 検証

- `test/server/backends/openPath.spec.ts` に追加 — セッション cwd 基準で解決されること、
  `artifacts/…` はワークスペース基準のままであること、ヘッダ無しは `CLAUDE_CWD` のままであること
- `absolutizePresentPath` の単体テスト — `..`/`.`/dotfile/絶対/`artifacts` 各ケース
- `test/server/backends/html.spec.ts` — 絶対パスの結果が `/htmlfile/abs/…` として
  往復すること（既存の `ws` ケースは残す）
- 手動 — `~/git/ai/mulmoterminal` で起動したセルから
  `presentDocument({ path: "README.md" })` を呼び、MulmoTerminal の README が開くこと。
  ビューで編集 → 保存がそのファイルに書き戻ること
- `yarn format` / `lint` / `typecheck` / `build` / `test`

## 決定（2026-08-01、着手時）

- **既定でオンにするか** → **常にオン。config キーは足さない**。
  `presentPathRoot: "session" | "workspace"` の切替は入れなかった。切替があると
  「どちらの基準で解決されたか」がツール結果からは分からないまま二通りになり、
  この plan が問題としている「黙って別プロジェクトのファイルを開く」の変種が残る。
  セッション文脈を持たない経路（スケジュール実行、feeds、直叩き、ビューの dispatch）は
  従来どおり `CLAUDE_CWD` にフォールバックするので、既存の非セッション経路の挙動は不変。
- **ツール prompt の文言** → **今回は触らない**。「workspace-relative」の説明は
  `@mulmoclaude/{markdown,html}-plugin` の共有 definition にあり、MulmoTerminal だけ
  書き換えると MulmoClaude と一つのツールが二つの意味を持つ。ホスト側で prompt を
  上書きする口は作らなかった。**core 側を「ホストのルート基準」という中立表現に直すのが
  本筋で、それは MulmoClaude 側の課題として残る**。

## 実装後のメモ

やることリストからの差分は 2 点だけ:

- ミドルウェアの登録は `server/index.ts` ではなく `server/routes/app-routes.ts`。
  ルートの mount は今はすべてそこにあり、`express.json` の直後・すべての
  `/api/plugin` ハンドラより前という位置が要件（html / mulmoscript の dispatch も
  同じ値を見る必要がある）
- 拡張子テーブルは `Record` ではなく `Map`。`constructor` / `__proto__` という名前の
  ツールがプロトタイプ経由で真値を引く問題（plugins-registry.ts が同じ理由で Map）

### レビューで足した 2 つのルール（PR #1226 / Codex 指摘）

1. **セッションの cwd がワークスペースそのものなら書き換えない**。マークダウンビューは
   文書内の相対画像 `![](images/x.png)` を文書のディレクトリ基準で解決し、
   `/api/files/raw?path=…` へワークスペース相対で投げる（`rewriteMarkdownImageRefs`）。
   docPath を絶対にするとこの URL が `<workspace>/home/…` を指して 404 になる。
   ワークスペース直下のセッションを**バイト単位でそのまま**通せば、今動いているものは
   何も壊れない（セッションを名乗らない経路もここに落ちるので同じく不変）。
   別プロジェクトの文書は相対画像を失うが、そこは今も「別プロジェクトの画像」を
   指しているので悪化はしない。根治は raw URL に cwd を載せられるようにすることで、
   これは共有プラグイン側の話。
2. **presentHtml で絶対化の結果にドット始まりセグメントが入るなら 400 + 理由**。
   `isPresentableHtmlPath` はドットセグメントを拒否し、それは正しい
   （`/htmlfile` マウントも拒否するので、通すと「成功したのに永久に描画されない」）。
   問題は MulmoTerminal 自身の管理 worktree が
   `~/.mulmoterminal/worktrees/<repo>-<hash>/<task>` に居ること — 実際にセッションが
   走る場所。プラグインの `invalid path: …` は「引数の綴りが違う」に読めるので、
   ミドルウェアで理由付きの 400 を返す。markdown はこのマウントを通らないので対象外。
