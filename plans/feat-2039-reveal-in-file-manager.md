# #2039 — ツリーの行から OS のファイルマネージャで開く

## 要望

ファイルツリーの行から Finder（等）を開く。**中身を見るためではなく、ファイルを人や
別のアプリに渡すため** — メールに添付する、提出フォームへドラッグする、エージェントが
読むフォルダへ大きいファイルを置く。

- ファイルの行 → そのファイルが**選択された状態**で親フォルダが開く
- フォルダの行 → **そのフォルダが開く**

## MulmoClaude が参照実装（CLAUDE.md の規則）

`../mulmoclaude` に同じ機能がある（issue #1985 → PR #2016）。合わせるもの:

| 合わせる点 | MulmoClaude | 本実装 |
| --- | --- | --- |
| ルートパス | `POST /api/files/reveal`（`src/config/apiRoutes.ts:142` が正）| 同じ |
| 成功 | `200 { ok: true }` | 同じ |
| 引数不足 | `400` | 同じ |
| 起動失敗 | `500` | 同じ |
| 文言 | `"Show in folder"`（`src/lang/en.ts:529`）| ファイル行は同じ |
| argv | darwin `open -R`、win32 `explorer.exe /select,`、他 `xdg-open <dirname>` | 同じ |

**意図的に違えるところ**（PR に明記する）:

- **WSL を見る。** MulmoClaude の `revealArgv` は `platform` だけで分岐するが、mulmoterminal は
  既に `openDirCommands()` で WSL を特別扱いしている（distro に `xdg-open` が無い / 見えない
  Linux アプリが開く、#1447）。同じ候補リストを reveal でも使い、`explorer.exe` →
  `xdg-open` のフォールバックを保つ。
- **フォルダの行にも出す。** MulmoClaude の reveal はファイル用。本要望はフォルダも対象で、
  そのときは「選択」ではなく「そのフォルダを開く」。文言も変える。

## 実装

**サーバ**: 新しいルート `POST /api/files/reveal`。候補リストは `openDirCommands()` を**再利用**
（プラットフォームごとの opener はフォルダを開くときと同じ）。新しく要るのは argv の組み立てだけ:

```
revealArgv(cmd, target, isDir)
  open          → isDir ? [target] : ["-R", target]
  explorer(.exe)→ isDir ? [target] : [`/select,${target}`]
  xdg-open      → [isDir ? target : dirname(target)]   // Linux に可搬な「選択」は無い
```

純粋関数なので単体で網羅できる。**シェルを通さない argv 配列**なので、名前に
シェルのメタ文字が入っても構文として再解釈されない。

**ガード**: `resolveDirRequest` と同じ門（same-origin → 絶対パス → 存在）を、ディレクトリ限定を
外した形で通す。**ワークスペースへの封じ込めは既存の `/api/open-dir` にも無い** — ローカルの
サーバであり、脅威モデルは「他所のサイトに叩かれないこと」で、そこは same-origin が担う。
reveal だけ厳しくすると一貫性を欠くので、同じ門に揃える。

**UI**: `filesRowActions.ts` の `FilesRowAction` に `reveal` を足す。`FilesRowTarget` に
`isDir` を足して、文言と挙動を行の種類で変える。**絶対パス**を載せる（ルートが絶対を要求する
ため）。`FilesPane.vue` が fetch する — emit しないのは、親の関与が無いサーバ副作用だから
（`writeBuffer` と同じ）。

**失敗は必ず見せる。** #1447 の教訓で、`TerminalCell.vue` の `openDir()` は失敗を
`showAskMsg` に出している。同じ扱いにする。

## 検証

- `revealArgv` を全プラットフォーム × ファイル/フォルダで網羅（異常系: 未知の cmd、
  空パス、シェルのメタ文字を含む名前）。
- ルートの spec: 400 / 404 / 403（origin）/ 200、spawn は注入して argv を assert する。
- `filesRowActions` の spec: ファイル行とフォルダ行で文言と payload が変わること。
- 反転 mutation で赤くなることを確認する。
- **Windows の fixture の罠**（`docs/windows-gotchas.md`）に注意 — symlink と禁止文字。
- `yarn format` → `lint` → `typecheck` → `build` → `test`。
