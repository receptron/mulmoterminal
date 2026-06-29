# fix: ポート衝突でクラッシュ / ランダムポート (#31)

## 症状

`npx mulmoterminal` でポート(3456)が使用中だと未処理の `EADDRINUSE` でクラッシュし、
直前に誤った "ready" バナーも表示される。

## 原因

1. **IPv4/IPv6 不一致**: ランチャの空き判定 `probe.listen(port, "127.0.0.1")`（IPv4）と
   サーバーの `server.listen(PORT)`（`::` デュアルスタック）でアドレスファミリがズレ、
   `::` で占有されたポートを「空き」と誤判定 → サーバーが衝突。
2. サーバーに `EADDRINUSE` ハンドラが無く未処理クラッシュ。

## 修正

- **server/index.ts**: `server.on("error")` で `EADDRINUSE`（と他のバインド失敗）を捕捉し、
  明確なメッセージを出して `exit(1)`（スタックトレースを出さない）。`hasErrnoCode` /
  `messageOf` を再利用。
- **bin/mulmoterminal.js**:
  - `isPortFree` の probe をホスト指定なし（`probe.listen(port)`）にし、サーバーの `::`
    バインドとファミリを一致させる。
  - フォールバックを逐次 `+1` から **OS 割り当ての空きポート（`listen(0)`）= ランダム**に変更
    （`findEphemeralPort`）。衝突しにくく、複数同時起動でも被らない。
  - 既定 3456 が空けば 3456、使用中ならランダム空きポート。`--port` 明示時は使用中なら
    従来どおりクリーンにエラー終了。

## 検証

- 3456 を占有した状態でランチャ起動 → `Port 3456 busy → using <random> instead` で起動（クラッシュなし）。
- `PORT=3456` でサーバー直接起動（占有時）→ `Port 3456 is already in use …` とだけ出て終了（トレースなし）。
- `yarn lint` / `typecheck` / `typecheck:server` / `test`(16) / `build` / `format:check` 緑。

## 備考

公開は別ステップ（次の `/publish` で 0.1.1 として反映）。
