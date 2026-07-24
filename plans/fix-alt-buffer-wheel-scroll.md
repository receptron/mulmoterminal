# fix: alt buffer でホイールが履歴めくりになる回帰 (#737)

## 原因

#729 でマウストラッキングの SET を swallow した結果、alt buffer のアプリ（Claude TUI）に
対して xterm が「scrollback なし・マウス無効」のフォールバックを適用し、ホイールを
↑/↓ 矢印シーケンスに変換して送るようになった。Claude は ↑/↓ を入力履歴に割り当てて
いるため、ホイール＝履歴めくりになった。#729 以前はトラッキング有効だったため、
ホイールはマウスレポートとして TUI に届き、TUI 自身がトランスクリプトをスクロールしていた。

## 修正

swallow したモードを端末ごとに記録し（SET で追加・RESET で削除。RESET は従来どおり
xterm へ素通し）、`attachCustomWheelEventHandler` で
「alt buffer かつ アプリが SGR ホイールトラッキングを要求済み」のときだけ
SGR ホイールレポート（`CSI < 64/65 ; 1 ; 1 M`）を `term.input()` で合成する。
それ以外（通常バッファ・未要求）は xterm の既定＝スクロールバックのまま。

- 判定・記録・シーケンス生成は `src/composables/wheelReports.ts` の純関数
  （`recordSwallowedModes` / `clearResetModes` / `wantsWheelReports` / `wheelReportSequence`）。
- 配線は `guardMouseTracking(term)` に抽出（#729 の CSI フックと同居）。
- 非 SGR エンコーディング（X10/urxvt）はスコープ外：現行ターゲットはすべて 1006 を要求する。
  未要求時は従来の矢印変換のまま。

## テスト

`test/src/composables/wheelReports.spec.ts` — 記録/解除（サブパラメータ含む）、
SGR とトラッキング両方が必要なこと、64/65・座標・deltaY=0。既存の
`useTerminalConnections.spec.ts` は DECRST フック追加を反映。
