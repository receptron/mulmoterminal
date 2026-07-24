# fix: 軽微なバグまとめ（#748）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

単体では軽微だが実害のあるバグをまとめて対応。worktree 系3件（worktree-diff:54 / worktree-pr:79 /
worktrees:221）は #743(PR #754) がそれらのファイルを触っているため、競合回避で **#754 マージ後の follow-up** に回す。

## 対応した9件

1. `common/modelPresets.ts` — Nemotron 3 Ultra の `contextLength` が `512_288`（512×1024 = `524_288` のタイプミス）。
2. `common/modelPresets.ts` — `presetsForProvider` がユーザーモデル同士（大文字小文字違い含む）を重複除去していなかった。追加済み id も `seen` に入れて除去。
3. `server/routes/plugin-narration.ts` — 空文字の upstream error が素通りし、失敗したツール呼び出しがエージェントに空メッセージ（＝ "Done"）として届く。非空チェックを追加。
4. `server/git/pr-for-branch.ts` — gh 失敗を「PR なし」として TTL 間キャッシュし、PR ボタンが隠れ続ける。**成功時のみキャッシュ**に変更。
5. `server/config/header-context.ts` — `worktreeTask` が `path.basename` を使うため task 配下のサブディレクトリで誤った名前を返す。`<root>/<repo>-<hash>/` 直下の第1セグメントを取る形にし、root 注入でテスト可能化。
6. `server/config/config-schema.ts` — zod v4 の `z.record(z.enum())` が exhaustive で、生成 JSON Schema が palette 23キー全部を required にする。`z.partialRecord` に変更（runtime 検証は不変）。
7. `server/infra/plugins-registry.ts` — ディスパッチ map がプレーンオブジェクトで、`constructor`/`__proto__` 等の名前がプロトタイプチェーン経由で truthy にヒット。`Map` に変更。
8. `server/backends/worklog.ts` — `WORKLOG_PROMPT` の書き込み許可が存在しないステップ (8) を参照（実際の書き込みは 7・7b）。参照を (7)(7b) に修正し、最終ステップを 9→8 に採番。
9. `server/backends/byte-range.ts` / `files.ts` — 不正/未対応の Range ヘッダに 416 を返していた（メディアのシーク失敗）。RFC 7233 に従い `RangeResult`（range/unsatisfiable/ignore）に分け、不正は無視して 200、範囲外のみ 416。

## テスト

各項目に回帰テストを追加（`modelPresets.spec.ts` 新規、他は既存 spec に追加）。
`plugin-narration` はバグ挙動を固定していた旧テストを修正挙動に置換。
主要項目はミューテーションで該当テストが赤になることを確認。全 3580 テスト + typecheck(server/test/app) + lint + build パス。

## follow-up（#754 マージ後）

- `worktree-diff.ts:54` — 裸リビジョンの曖昧さ（`--` 区切り）
- `worktree-pr.ts:79` — PR 再作成で既存 PR ではなく compare ページを開く
- `worktrees.ts:221` — `removeWorktree` の非正規化パス比較で `deleteBranch` がスキップ
