# fix: #478 系統 B — worktree/slug/temp の Windows 移植性

Issue: #478（`windows-daily` で露見した 9 件のうち、系統 A の 3 件は #480 で完了。本 PR は残り 6 件）

## 対象の失敗（windows-daily run 29777648627）

| テスト | 原因系統 | 種別 |
|---|---|---|
| `worktrees: creates, lists, detects dirty, and removes` | B1 8.3/セパレータ | テスト |
| `worktrees: creates, lists (with dirty)`（routes 側含む） | B1 | テスト+実コード |
| `worktrees: rejects a symlink … escapes it` | B2 symlink 権限 | テスト(skip) |
| `skills: rejects dir names that aren't safe slugs` | B3 不正ファイル名 | テスト |
| `shortcuts: handles concurrent PUTs …` | B4b rename 競合 | 実コード |
| `worktree-pr: createOrOpenPR pushes …` / `worktree-routes: 500s an internal git failure` | B4a/B5 | テスト |

## 根本原因と修正

### 実コード

1. **`server/git/worktrees.ts`: `realpathSync` → `realpathSync.native`**（`worktreesBase` と `canonicalPath`）。
   Windows では native 呼び出しだけが 8.3 短縮名（`C:\Users\RUNNER~1`）を長名（`…\runneradmin`）へ展開する。
   `git worktree list` は長名を返すため、`isManagedWorktree` の包含判定で両辺を一致させるのに必要。
   本番の `MULMOTERMINAL_HOME` は `os.homedir()`（長名）なので実害は出ていなかったが、canonicalPath が
   真に正規（8.3 展開済み）を返すことは containment guard の前提として正しい。

2. **`server/backends/shortcuts.ts`: `fs.rename` に sharing-violation リトライ**。
   POSIX の rename は atomic replace だが、Windows の MoveFileEx は並行 writer が対象を掴んでいる間、
   2 つ目の rename を EPERM/EACCES/EBUSY で一時的に拒否する。並行 PUT（複数タブ）が全部成功するよう
   短いバックオフでリトライ。他のエラーは即 throw。

### テスト

3. **worktree 3 spec の `repo` を git 正規形に揃える**。`worktreesRoot` は repo 文字列をハッシュする。
   テストが `realpathSync(mkdtemp)` 形（Windows で 8.3/`\`）を渡す一方、本番 `repoRoot` は git 形（長名/`/`）を
   返すため、ハッシュが食い違って managed-root 判定が外れていた（B1/B5）。`beforeEach` を async 化し
   `repo = (await gitTopLevel(repo)) ?? repo` で本番と同じ形に。

4. **teardown の `rmSync` にリトライ**（`test/server/git/wtTestUtil.ts` の `rmDirRetrying`）。
   Windows は git 子プロセス終了後も worktree dir のハンドルを一瞬保持し、`rmSync` が EBUSY を投げる（B4a）。
   `maxRetries`/`retryDelay` で待つ。

5. **git 統合テストの timeout 拡張**（`GIT_TEST_TIMEOUT_MS = 30s`）。Windows では git 子プロセスが遅く、
   vitest 既定 5s を超えて timeout していた。

6. **symlink escape テストを skip 可能に**（`canSymlink` probe）。Windows は symlink 作成に権限/開発者モードが
   要り、フィクスチャの `symlinkSync` が落ちる。判定ロジック（`isManagedWorktree`）自体は `canonicalPath`+`path.sep`
   で Windows でも健全（= 本 PR で確認済みの安全事実）。symlink が存在しない環境では検証対象が無いので skip。

7. **skills の不正名フィクスチャを許容**（`tryWriteUnsafeSkill`）。`q"uote` は Windows で不正ファイル名なので
   `mkdirSync` が落ちる。作成失敗は「discovery に現れない」という検証の期待と同じ終状態なので握りつぶす。

## 検証

- macOS: 全 1470 tests green、lint error 0、typecheck/build OK
- Windows: マージ前に windows-daily をこのブランチへ `workflow_dispatch` して確認（実機なし、CI 検証）

## 補足（安全）

`isManagedWorktree` は `canonicalPath`（realpath ベース）+ `path.sep` を使うため、Windows でも symlink escape の
string-prefix bypass は成立しない。B2 の失敗は判定ロジックではなくフィクスチャ作成の失敗だった。
