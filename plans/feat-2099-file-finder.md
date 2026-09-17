# feat: ファイルペインの「名前で探して開く」（#2099）

## きっかけ

> ファイルペインのツリーは、ディレクトリを 1 階層ずつ展開していく方式です。深い場所にある
> ファイルや、どのディレクトリにあるかをはっきり覚えていないファイルを開くには、ツリーを
> 順番にたどるしかなく、ファイル名が分かっていても時間がかかります。（#2099）

VS Code の Command+P に相当するものが欲しい、という要望。ブラウザでは Cmd+P が印刷なので
**既定のキーは割り当てない** — `keymap` に新しいアクションを足し、ユーザーが自分で割り当てる。

## 入口は 2 つ（オーナー判断 2026-09-17）

`keymap` には既定がない（未設定＝無効）ので、キーだけにするとこの機能は **未設定の人には
存在しないのと同じ**になる。そこで:

1. `keymap` アクション `files-find` — 拡大中のセルのペインで検索欄を開く。ペインが閉じていれば
   **そのセルの cwd で開いてから**検索欄を出す（#2099 の最後の要望）。
2. Files ペインのヘッダーに検索ボタン — キーを割り当てていない人でも見つけられる。全画面の
   Files ビュー（`/files`）でも同じボタンが効く。こちらはルートが違うのでグリッドの
   キーハンドラが走らず、ボタンが唯一の入口になる。

## 候補の作り方 — サーバが一覧を返し、ブラウザで絞り込む（オーナー判断 2026-09-17）

打鍵ごとにサーバへ行かない。ペインを開いた時点で 1 回だけ一覧を取り、絞り込みはブラウザの
純関数がやる。理由は 2 つ:

- 体感。打鍵ごとの往復が無い。
- **マッチャが純関数になり、DOM もサーバも無しでテストできる。** この機能の価値はほぼ全部
  マッチの質（「多少あいまいな入力でも一致してほしい」）なので、そこが測れる形であることが要る。

代償は一覧のサイズ。このリポジトリで `git ls-files -co --exclude-standard` は 3000 行弱・
100KB 程度。上限を設け、**超えたら UI にそう書く**（黙って切らない）。

### `.gitignore` を守る方法 — git に聞く

`.gitignore` を自前で解釈しない。`server/backends/collectionSelfContainment.ts` が既に
同じ判断を `git ls-files --others --ignored --exclude-standard` でやっており、その理由
（ネストした `.gitignore`、`.git/info/exclude`、グローバル設定、否定パターン）はここでも同じ。

- git リポジトリ: `git ls-files -co --exclude-standard -z`（追跡中 + 未追跡で無視されていない）。
  `-z` は NUL 区切りなので、改行を含むファイル名でも壊れず、`core.quotePath` の八進エスケープも
  出ない。`git -C <cwd>` で走らせるので **パスは cwd 相対**で返る = ペインのツリーの相対パスと同じ。
- git 以外のディレクトリ: 自前の深さ優先の走査。`.git` と既知の重量級ディレクトリだけ名前で外し、
  訪問数にも上限を置く。シンボリックリンクのディレクトリは辿らない（循環）。
  **ここでは `.gitignore` は効かない**ので、その旨を返り値の `source` で区別できるようにする。

## 置き場所

| 何 | どこ | なぜ |
|---|---|---|
| 一覧の生成 | `server/files/project-files.ts` | git を呼ぶ / 走査する。純粋でない部分はここだけ |
| ルート | `GET /api/files/browse/index` | `files-browse.ts` の他のルートと同じ `?cwd=` + containment |
| マッチャ | `src/components/filePathMatch.ts` | UI しか使わない（`common/` は両側が判断に使うものだけ） |
| 祖先ディレクトリの列挙 | `src/components/filesTreeState.ts` に追加 | ツリーの状態にまつわる純関数の既存の置き場 |
| パレット UI | `src/components/FileFinder.vue` | 自前で fetch する。FilesPane 側の追加を小さく保つ |
| アクション | `common/keymap.ts` の `KEYMAP_ACTIONS` | 追加するだけで config が受け付ける |

### FilesPane.vue が行数上限を超えるので、サーバとの通信部分を先に出す

`max-lines` は 1 ファイル 600 行（コメント・空行を除く）。FilesPane.vue はその直下にいて、
この機能の追加分で超える。**行数を減らすためだけの分割はしない**——出すのは
**コンポーネントの状態に一切触れていない 3 つの関数**（`writeBuffer` / `bankText` /
OS へ投げる `askTheMachine`）と、それらが組み立てる `?cwd=&path=`。
`src/components/filesPaneApi.ts` に移し、**直接のテストを付ける**。

これらは「値を返すだけ」なのに、これまでは**エディタを mount しないと 1 行も実行できなかった**。
しかも中身は、この機能で一番大事な失敗——保存が version race に負ける（409）、backup store が
書き込みを拒む、ファイルマネージャを持たないホスト——ばかり。1 呼び出し 1 アサーションになる。

**挙動が変わっていないことの根拠**：既存の `FilesPane.spec.ts` /
`filesRowMenu.spec.ts` / `FilesOverlay.spec.ts` / `gridOpenFiles.spec.ts` を**一切変更せずに**
移動の前後で走らせる。これらは実 DOM で pane を mount して保存・競合・row menu を叩いている。
`revealInFileManager` と `openInOs` はメッセージの文言が違う（前者は絶対パス、後者は相対パスを
名指す）ので、`failure` を引数にして**文字列を 1 文字も変えない**。

## マッチャの設計

`matchPath(path, query)` → `{ score, indexes } | null`。

- **2 段階**。まず部分列（subsequence）かどうかを 1 パスで判定して落とす。生き残ったものだけ
  DP で採点する。長いクエリほど生存数が減るので、DP のコストは自然に抑えられる。
- DP は 2 面（fzf と同じ形）: `D[i][j]` = `q[i]` を `p[j]` で**当てた**ときの最善、
  `M[i][j]` = `q[i]` を `j` までのどこかで当てたときの最善。`M` から逆に辿って `indexes` を作る。
- ボーナス: 連続、境界（先頭 / `/` `-` `_` `.` の直後 / camelCase の切れ目）、**basename の中**。
  最後のが「パスの途中より、ファイル名そのものに当たったほうが上」を作る。
- 同点の並びは **パスが短い順 → 辞書順**。テストが決定的になる。
- 大文字小文字は無視（両方 lowercase にしてから比較）。

## ツリー側の反映

要望にある「ツリー側でもそのファイルの位置が分かる」。選んだら:

1. `ancestorDirs(pathRel)` で祖先を浅い順に列挙し、順に `toggleDir`（各展開が子を fetch するので
   親が先でなければならない — `restoreOrder` と同じ理由）。
2. `loadFile(pathRel)` で開く。
3. 行を `scrollIntoView`。行に `data-path` を足して引けるようにする。

## やらないこと

- 中身の全文検索。これはファイル名だけ。
- 既定のキー割り当て。
- 一覧のキャッシュ。エージェントが隣で走っている以上、開くたびに取り直すほうが正しい。
- タイル表示（拡大していない状態）でのショートカット。ペインは拡大した行にしか無いので、
  `files-find` は `NEEDS_A_CURRENT_TERMINAL` に入れる（`validateKeymap` がそう説明する）。

## テスト

- `test/src/components/filePathMatch.spec.ts` — 部分列でないものを落とす、basename 優先、
  連続優先、境界優先、空クエリ、クエリがパスより長い、大文字小文字、同点の並び、
  `indexes` が実際にその文字を指している（生成入力で照合）。
- `test/src/components/filesTreeState.spec.ts`（既存があれば追記）— `ancestorDirs`。
- `test/server/files/project-files.spec.ts` — git リポジトリで `.gitignore` されたものが出ない、
  サブディレクトリを cwd にすると相対パスがそこ基準、git でないディレクトリの走査と上限、
  上限超過が `truncated` で出る。
- `test/server/files/files-browse.spec.ts` に追記 — ルートの containment と 4xx。
- `test/src/components/FileFinder.spec.ts` — 絞り込み・上下キー・Enter・Escape・外側クリック、
  「一覧が全部ではない」2 つの但し書きが出る条件。
- `test/src/components/filesFinderInPane.spec.ts` — pane との接続部。ボタンで開く、host から
  開く（ショートカットの経路）、選ぶとツリーが祖先まで開いて開く、reload で閉じる。
- `test/src/components/filesPaneApi.spec.ts` — 上で切り出した 3 関数。409 / backup 拒否 /
  opener を持たないホスト。

## ドキュメント

- `server/skills/mulmoterminal-keys/SKILL.md` のアクション表に 1 行。
- `docs/guide/{en,ja}/config.md` の keymap 表に 1 行。
- `src/i18n/{en,ja}.ts` の `settings.shortcuts.actions` に 1 行（`keymapLabels.ts` は
  `Record<KeymapAction, string>` なので、足さないとコンパイルが通らない）。
- `docs/ChangeLog.md` の Unreleased。

## 実機確認（2026-09-17）

`yarn dev` を隔離したポート（34599 / 6899）と**スクラッチの `HOME`** で起動して確認した。
`HOME` を差し替えたのは、`keymap` を書くのに**ユーザーの実際の `~/.mulmoterminal/config.json` を
触らないため**（`server/config/env.ts` の `MULMOTERMINAL_HOME` は worktree 用で、app config は
`os.homedir()` を見る）。

- `GET /api/files/browse/index?cwd=<このリポジトリ>` を curl → `source: "git"`、`node_modules`
  と `.git` が 0 件、まだ commit していない新規ファイルも入っている。
- `/files?cwd=<このリポジトリ>` を実ブラウザで開き、ヘッダーの検索ボタン →`fpane` と入力 →
  `src/components/FilesPane.vue` が 1 位、ハイライトはマッチした文字の上に出る → Enter で
  エディタに開き、**ツリーが `src/components` まで展開されてその行までスクロールした**。
- スクラッチの `config.json` に `{"keymap": {"zoom-toggle": "F8", "files-find": "F9"}}` を書き、
  グリッドでセルを 1 つ起動 → F8 で拡大 → **ペインを開いていない状態で F9** → ペインが開き、
  その上に検索欄が出た（#2099 の最後の要望）。`errrec` と打って Enter でそのファイルが開いた。
- そのセルの cwd は git リポジトリではなかったので、**「Not a git repository, so nothing here is
  filtered by .gitignore.」の但し書きが実際に出た**（walk 側の分岐）。
