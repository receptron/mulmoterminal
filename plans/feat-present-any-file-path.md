# feat: presentDocument / presentHtml でディスク上の任意ファイルを開き、その場で編集する

## Goal

MulmoTerminal で GitHub プロジェクトの `README.md` を開こうとすると
`presentDocument は artifacts/documents/ 配下のパスしか直接参照できない` と拒否される。
MulmoClaude 側 (PR #2636 / #2639) でこの制約を外し、**`path` 引数は任意の `.md` /
`.html`**（workspace 相対でも絶対パスでも可）を受け付けるようになった。view での編集
（Apply、タスクチェックボックス、HTML のソース編集）は**その同じファイルを上書き**する。

MulmoTerminal 側にも同じ結線を入れるのがこの plan。共有ロジックはすべて
`@mulmoclaude/core` に入っているので、ここでやるのは**薄いホスト束縛だけ**——
判定ロジックを書き直してはいけない（両ホストで判定がずれると、片方が受理した
パスをもう片方が拒否する、という形でユーザーに見えるバグになる）。

> **前提**: 下の 3 パッケージが npm に公開されていること。公開前は
> `yarn install` が解決できずビルドが通らない。
>
> | package | version | 何が入ったか |
> |---|---|---|
> | `@mulmoclaude/core` | `^1.8.0` | パス判定 (`./artifacts`)、by-path ファイル操作と `/htmlfile` パーサ (`./files`)、markdown sanitizer (`./plugin-vue`) |
> | `@mulmoclaude/html-plugin` | `^1.2.0` | `path` の受理範囲拡大、`files.byPath` capability、`/htmlfile` URL スキーム |
> | `@mulmoclaude/markdown-plugin` | `^1.3.0` | `path` の受理範囲拡大、`data.docPath`、view の DOMPurify sanitize |

## 何が core から降りてくるか

**`@mulmoclaude/core/artifacts`**（browser-safe / 純粋な字句判定）

| export | 役割 |
|---|---|
| `classifyFilePath(value, extensions)` | `"absolute"` / `"relative"` / `null`。拡張子、NUL なし、`.` `..` 空セグメントなしを見る |
| `isAbsoluteFilePathValue(value)` | `/x`、`C:\x`、`\\server\share`、Windows root-relative `\dir\x` |
| `hasDotfileSegment(value)` | 配信マウントが dotfile を拒否するので、受理側もこれで揃える |

**`@mulmoclaude/core/files`**（server 専用）

| export | 役割 |
|---|---|
| `resolveByPath(root, value, extensions)` | 相対 → `root` 起点、絶対 → そのまま。**このプラットフォームの `path.isAbsolute` が同意しない値は null**（POSIX で `C:/x.md` は cwd 配下に落ちるため） |
| `existsAsFile(root, value, extensions)` | realpath して通常ファイルか |
| `createByPathFileOps({ rootFor, extensions })` | `files.byPath` capability の実体。**read / write / stat / exists のみ**。`readDir` / `unlink` は unsupported で reject。write は上書き専用（存在しないパスには書かない）で、symlink はターゲットに書く |
| `resolveHtmlFileRequestPath(workspaceRoot, reqPath)` | `/htmlfile/<scope>/<segments…>` → 絶対パス。scope は `ws` / `abs`、`.` `..` dotfile、および **decode 後に区切りを含むセグメント**（`%2F` 密輸）を拒否 |
| `MARKDOWN_EXTENSIONS` / `HTML_EXTENSIONS` | `[".md"]` / `[".html", ".htm"]` |

**`@mulmoclaude/html-plugin`**: `HTML_FILE_MOUNT`(`"/htmlfile"`)、`HTML_FILE_SCOPE_WORKSPACE`(`"ws"`)、
`HTML_FILE_SCOPE_ABSOLUTE`(`"abs"`)、`htmlFileUrl(filePath)`、`isPresentableHtmlPath(value)`。
`HtmlExecuteContext` / `HtmlDispatchContext` の `files` に **optional な `byPath`** が増えた
（渡さなければ従来の `artifacts/html` 限定挙動のまま＝安全に degrade する）。

**`@mulmoclaude/markdown-plugin`**: 結果データに `docPath` が増えた。view は
`documentPathOf(data)`（`docPath` 優先、無ければ旧 `artifacts/documents/**.md` prefix 規則）で
読み書き対象を決める。ホスト側の `MarkdownHostApp` contract は**変更なし** —
`loadDoc` / `saveDoc` が受け取る値の範囲が広がるだけ。

## MulmoTerminal 側の実装

### 1. `server/backends/openPath.ts`（新規）

`@mulmoclaude/core/files` に workspace を注入するだけの薄い層。`artifacts.ts` と同じく
**per-call で root を読む**（workspace は boot 時注入で、ops は registry のクロージャに
先に束縛されるため）。

```ts
let workspace: string | null = null;
export function initOpenPathBackend(deps: { workspace: string }): void { workspace = deps.workspace; }
const rootFor = () => { if (!workspace) throw new Error("open-path backend not initialised"); return workspace; };

export const markdownByPath = createByPathFileOps({ rootFor, extensions: MARKDOWN_EXTENSIONS });
export const htmlByPath = createByPathFileOps({ rootFor, extensions: HTML_EXTENSIONS });
export const resolveHtmlRequest = (reqPath: string) => resolveHtmlFileRequestPath(rootFor(), reqPath);
```

`server/index.ts` の `initArtifactsBackend({ workspace: CLAUDE_CWD })` の隣で
`initOpenPathBackend({ workspace: CLAUDE_CWD })` を呼ぶ。

**`backends/fileOps.ts` と混同しないこと。** あちらは「プラグインを 1 ディレクトリに
閉じ込める」ためのもので、こちらは意図的に封じ込めない。用途が逆。

### 2. `server/backends/markdown.ts`

`markdownHostApp.loadDoc` / `saveDoc` の `isDocPath` ゲートを外し、`markdownByPath` に委ねる。

```ts
async loadDoc(rel) { return { content: await markdownByPath.read(rel) }; },
async saveDoc(rel, markdown) { await markdownByPath.write(rel, markdown); await publishFileChange(rel); return { path: rel }; },
```

`saveNewDoc` は**変更しない** — 新規作成は今まで通り `buildDocPath` で
`artifacts/documents/YYYY/MM/` に作る。`docPath.ts` の `isDocPath` / `buildDocPath` /
`sanitizeDocPrefix` もそのまま残す（作成パスの検証にはまだ必要）。

### 3. `server/backends/fileChange.ts`

markdown scope の matcher が `isDocPath`（= `artifacts/documents/` 限定）のままだと、
リポジトリのファイルを保存しても view が live-refresh しない。**書き込みサイトが
受理する範囲と一致させる**：

```ts
const isMarkdownDoc = (posixPath: string) => posixPath.endsWith(".md");
// pluginScopes: [{ scope: "markdown", matches: isMarkdownDoc }, { scope: "html", matches: isHtmlDoc }]
```

`isHtmlDoc` は既に `.html` 全体なのでそのまま。

> 注: `publishFileChange` は workspace 相対パス前提。**絶対パス**で開いたファイルの
> 保存でどう振る舞うかは要確認（チャンネル名がパス文字列なので publish 自体は通るが、
> workspace 外のファイルは watcher が拾わない）。self-save の refresh は view 側の
> `pendingSelfSaves` で吸収されるため実害は薄い、という想定。

### 4. `server/backends/html.ts`

- dispatch (`loadHtml` / `saveHtml`) のコンテキストに `byPath` を足す:
  `executeHtmlDispatch({ files: { artifacts: artifactsFileOps, byPath: htmlByPath } }, args)`
- `/htmlfile` ルートを追加。`mountHtmlPreviewRoute` と**同じ CSP**（`HTML_PREVIEW_CSP`）、
  同じ `statFileOr404` + `streamFileToResponse`。違うのは**封じ込めルートが無い**点だけ:

```ts
app.get(/^\/htmlfile\/(.+)/, (req, res) => {
  const abs = resolveHtmlRequest(req.params[0] ?? "");   // scope / traversal / dotfile / %2F は core 側で判定済み
  if (abs === null) { res.status(404).json({ error: "not found" }); return; }
  const stat = statFileOr404(res, abs);
  if (!stat) return;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", HTML_PREVIEW_CSP);
  streamFileToResponse(abs, res);
});
```

`server/index.ts` の `mountHtmlPreviewRoute` の隣で登録する。

**やってはいけないこと**: `req.params[0]` を自前で `split("/")` して検証する。
`%2F` / `%5C` を decode 前に分割すると区切りを密輸されて封じ込めを抜けられる
（MulmoClaude で実際に指摘された）。`resolveHtmlFileRequestPath` にそのまま渡す。

### 5. `server/infra/plugins-registry.ts`

tool-call パス（`kind` 無しの execute）は generic loader 経由なので、`FILES_CONTEXT` に
`byPath` を足さないと `presentHtml(path)` の artifacts 外が通らない。

```ts
const FILES_CONTEXT = { artifacts: artifactsFileOps, byPath: htmlByPath };
```

> **決めること**: `FILES_CONTEXT` は全プラグイン共有の 1 オブジェクトなので、拡張子で
> 絞った FileOps を 1 つだけ置くのは将来の別プラグインに対して雑。今のところ
> `files.byPath` を読むのは presentHtml だけなので `htmlByPath` で足りるが、
> 2 つ目が出たらツール名ごとのコンテキストに分ける（MulmoClaude は route ごとに
> 組み立てているのでこの問題が無い）。

### 6. `package.json`

`@mulmoclaude/core` `^1.8.0` / `@mulmoclaude/html-plugin` `^1.2.0` /
`@mulmoclaude/markdown-plugin` `^1.3.0` へ。

## 引き継ぐべき既知の落とし穴

MulmoClaude 側のレビューで実際に出た指摘。**core を使っていれば全部避けられる**が、
自前で書き直すと踏み直すことになる。

1. **`%2F` 密輸** — URL のセグメント分割は decode の前。decode 後に `/` `\` を含む
   セグメントは拒否する。
2. **Windows 絶対パス** — `classifyFilePath` はどのプラットフォームでも `C:\x.md` を
   absolute と判定する（値がリモートホスト由来のことがあるため）。しかし POSIX で
   `path.resolve("C:/x.md")` は cwd 配下に落ちる。解決側は `path.isAbsolute` が
   同意しない値を拒否する。
3. **Windows root-relative `\dir\x`** — Windows では `path.resolve` がドライブルートへ
   送るので、relative 扱いにすると判定と解決がずれる。
4. **symlink 上書き** — `writeFileAtomic` は rename で置き換えるので、リンクのパスに
   書くとリンク自体が通常ファイルになり実体は変わらない。realpath 先に書く。
5. **ディレクトリ / FIFO** — `report.md` という名前の**ディレクトリ**は存在チェックを
   通ってしまい、読み込みで EISDIR。FIFO は読みが永久ブロック。`isFile()` を見る。
6. **dotfile の非対称** — 受理側が `.hidden/page.html` を通すのに配信側が拒否すると、
   ツールは成功を返して iframe が必ず 404 になる。`hasDotfileSegment` で両側を揃える。
7. **stale な更新は 400** — 上書き対象が消えているのは view が古いかパスが誤りで、
   サーバ障害ではない。500 にしない。
8. **XSS** — 任意の md を開けるということは、view がレンダリングする markdown は
   もうこのアプリが書いたものではない（clone してきたリポジトリの README など）。
   plugin の View 側で DOMPurify sanitize 済み（`@mulmoclaude/core/plugin-vue` の
   `sanitizeMarkdownHtml`）なので、**プラグインを上げれば対応も入る**。Marp は
   `sandbox=""` の iframe なので対象外。

## セキュリティ上の位置づけ（意図的な決定）

`path` は**ディスク上の絶対パスを許す**。したがって:

- view からの書き戻しは **workspace 外のファイルも上書きできる**。エージェントは元々
  Bash で任意ファイルを読み書きできるので新しい権限ではないが、誤ったパスは
  破壊的なパスになる。書き込みは**上書き専用**（新規作成しない）でそこを狭めている。
- `/htmlfile` は**ディスク上の任意の HTML を iframe に配信する**。信頼境界は
  loopback 限定リスナ + 同一オリジン + 拡張子 allowlist + dotfile 拒否 + CSP。
  MulmoClaude 側では CodeQL が `js/path-injection` を上げ続けるが、これは
  「封じ込めを外した」という設計そのものを指しているのでコードでは解消できない。

## 動作確認

publish 後に `yarn install` してから:

1. 適当な git リポジトリを MulmoTerminal で開き、`README.md を presentDocument で開いて`
   と頼む → view に表示され、`artifacts/documents/` にコピーが**作られない**こと
2. view で編集 → Apply → **元の `README.md`** が書き換わること（`git diff` で確認）
3. タスクリストのチェックボックスをクリック → 同じファイルに反映されること
4. `docs/foo.html` のような artifacts 外の HTML を `presentHtml(path)` で開く →
   iframe が表示されること（URL が `/htmlfile/ws/docs/foo.html` になる）
5. ソース編集 → Apply → 元ファイルが書き換わること
6. `../` を含むパス、`.hidden/x.html`、存在しないパス → いずれもエラーが返り、
   view が「成功したのに空」にならないこと
7. 絶対パス（workspace 外）で 1〜5 が同じように動くこと

自動テストは MulmoClaude 側（`test/routes/test_presentDocumentRoute.ts`,
`test_presentHtmlPathRoute.ts`, `test_htmlFileUrl.ts`, `test/utils/files/test_byPath.ts`）に
あるので、MulmoTerminal 側は**ホスト束縛の結線**（`/htmlfile` ルートが core パーサを
呼んでいる、`FILES_CONTEXT` に byPath がある）に絞った薄いテストで足りる。

## 参照

- MulmoClaude PR #2636（`path` 引数の追加）/ #2639（任意パスへの拡大）
- `packages/core/src/files/byPath.ts` — ルールとその理由がコメントに書いてある
- `packages/core/src/files/htmlFileRequest.ts` — `/htmlfile` スキームのサーバ側
- `packages/plugins/html-plugin/src/core/paths.ts` — 同スキームのクライアント側
