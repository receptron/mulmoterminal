# fix: dev-server supervisor テストの Windows fs.watch flake

## User Prompt

> https://github.com/receptron/mulmoterminal/actions/runs/30087539279 fix

（main の #773 マージ run で Windows CI が失敗）

## 症状

`test/scripts/dev-server.spec.ts > restarts the backend when a watched source file changes` が
**Windows 24.x で失敗・22.x で pass**（同一 run 内）＝典型的な flake。他 OS では常に pass。

## 原因

このテストは watchDir にソースファイルを**1回だけ書き込み**、supervisor の `fs.watch` が
それを検知して再起動することを期待していた。しかし:
- `fs.watch` は**イベント配信を保証しない**（Node ドキュメント）。とくに Windows では recursive watch の
  arm が遅れたり最初のイベントを取りこぼすことがある。
- `os.tmpdir()` は Windows CI で 8.3 短縮パス（`C:\Users\RUNNER~1\…`）になり、fs.watch が不安定
  （`docs/windows-gotchas.md`）。

1回の書き込みが取りこぼされると再起動が起きず、`bootCount < 2` でテストが落ちる。

## 修正（テストのみ）

- watchDir を `realpathSync` で実パス化（8.3 短縮パスを展開）。
- ポーリングループで、再起動（2回目の boot）が観測されるまで**毎回ソースを再タッチ**。
  取りこぼし/arm 遅延があっても後続の書き込みが確実にトリガーする。余分な再起動は `>=2` 判定を通すだけ。
- デバウンス（120ms）より長い 200ms 間隔、タイムアウトは 20s に。

production コード（supervisor）は変更なし。fs.watch の非保証性に対するテストの堅牢化。

## 検証

macOS で3回連続パス。typecheck / build / lint パス。
