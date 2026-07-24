# feat: npx キャッシュ破損の検知と復旧ヒント (#735)

## 問題

npx の初回インストールがロック競合（npm 11.x の `ECOMPROMISED`）で展開途中に abort すると、
`~/.npm/_npx/<hash>/node_modules` が部分展開のまま残り、次回実行が
`ERR_MODULE_NOT_FOUND`（例: `compress-commons`）で落ちる。ユーザーからはパッケージ自体の
破損に見え、切り分けできない。

## 方針

launcher がサーバ子プロセスの stderr を監視し、異常終了時に「npx キャッシュ配下の
モジュール解決失敗」を検知したら、該当キャッシュディレクトリの削除と再実行を案内する。

## 実装

1. `bin/npx-cache-hint.js`（純関数、`.d.ts` 併設）
   - `detectNpxCacheDir(stderrText)` — `ERR_MODULE_NOT_FOUND` / `Cannot find package|module`
     と `_npx/<hash>` を含むパスが両方あるときだけ、`…/_npx/<hash>` を返す（それ以外 null）。
     POSIX / Windows 区切りの両対応。
   - `npxCacheHintMessage(cacheDir)` — ユーザー向けメッセージ（原因＝npm の npx キャッシュ破損、
     対処＝`rm -rf <dir>` して再実行）。
2. `bin/mulmoterminal.js` の `runServer`
   - spawn の stdio を `["inherit", "inherit", "pipe"]` に変更。stderr は `process.stderr` へ
     パススルーしつつ、末尾 64KB を有界バッファに保持。
   - `exit` で code が非 0 かつ PORT_IN_USE(75) 以外のとき検知を実行し、ヒットしたら
     ヒントを表示してから既存どおりの code で exit。
3. テスト `test/bin/npx-cache-hint.spec.ts`
   - 実際の 1.7.0 障害の stderr を fixture に、検知・非検知（通常のクラッシュ、_npx を含まない
     ERR_MODULE_NOT_FOUND、ERR なしで _npx パスのみ）・Windows パス・複数パスの先頭抽出を網羅。

## 非対象

- npm 側のレース（`libnpmexec/with-lock.js`）の修正 — upstream の問題。
- キャッシュの自動削除 — ユーザーのディレクトリを勝手に消さない。案内のみ。
