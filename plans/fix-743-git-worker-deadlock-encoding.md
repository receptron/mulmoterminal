# fix: git ワーカーのデッドロックと文字化け（#743）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 1. `git()` が stderr を読まずデッドロック（`server/git/worktrees.ts`）

`git()` は `stdio: ["ignore", "pipe", "pipe"]` で stderr パイプを開くのに stdout しか購読しておらず、
git が stderr に 64KB 以上出力するとパイプバッファが埋まって git 側が write でブロック → デッドロック。
git-lfs 未インストール等で `git worktree add` が大量の smudge エラーを出す場合に発生し、
`/api/worktrees/create` が永久ハング、以降の作成要求も全て詰まる。

**修正**: stderr を drain（破棄）して読み続ける。あわせて stdout をバイト蓄積 + 末尾で1回デコードに変更
（マルチバイト文字のチャンク分断対策）。ハング保険として `timeout: 120000ms` を追加。

## 2. spawn-collect のチャンク境界 UTF-8 破損 + タイムアウト無し（`server/git/spawn-collect.ts`）

チャンクごとに `Buffer.toString()` していたため、UTF-8 の 1 文字がパイプのチャンク境界で分断されると
置換文字に化ける（日本語の PR タイトル・ブランチ名・コミットメッセージ）。

**修正**: stdout/stderr を `Buffer[]` に蓄積し、close 時に `Buffer.concat(...).toString("utf8")` で1回デコード。
`gh` のストール対策として `timeout: 30000ms`（`timeoutMs` で上書き可）を追加。

## 3. worktree diff の非ASCIIパスが C クォート/8進エスケープのまま（`server/git/worktree-diff.ts`）

git はデフォルト（`core.quotePath` on）で非ASCIIパスを `"\346\227\245..."` の形で出力する。
`changedFiles`（numstat / ls-files）と `diffPatch`（patch ヘッダ）がこれをそのまま返していた。

**修正**: 該当 git 呼び出しに `-c core.quotePath=false` を付与し、生の UTF-8 で出させる。

## テスト

`test/server/git/spawn-collect.spec.ts`（新規）:
- 成功/非ゼロ終了+stderr/spawn 失敗。
- マルチバイト UTF-8 のチャンク分断（子プロセスが `日` の 3 バイトを 1+2 に分けて出力）で `日本語` が保たれること。
  per-chunk toString に戻すと赤になることを確認。
- タイムアウトで kill され ok:false。

`test/server/git/worktree-diff.spec.ts`（実 git 統合テストに追加）:
- 日本語ファイル名（tracked/untracked/patch）が生のまま返り、`\` を含まないこと。
  `core.quotePath=false` を外すと赤になることを確認。

実 git 3.x（tmux 検証と同様に実機）で `-c core.quotePath=false` が octal を解くことを事前確認。
全 git テスト 126 件 + typecheck / lint パス。
