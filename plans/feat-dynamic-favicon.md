# feat: 動的 favicon（ターミナル `>_` マーク・状態で切替）

Issue: #153

## User Prompt

> mulmoclaudeを参考に、faviconの設定と状態による切り替えを実装して。mulmoclaudeと違いがわかるとさらによいね！！

## 現状

`index.html` は `<link rel="icon" href="/favicon.svg">` を参照するが、`favicon.svg` は存在せず（`public/` も無し）404。実質 favicon 未設定。

## 参考（mulmoclaude）

2層構造：
- `useFaviconState`：セッション群から状態（running/done/idle）と色を算出（時間帯・誕生日・CPU負荷など多彩な flavour 付き）→ `useDynamicFavicon` を呼ぶ。
- `useDynamicFavicon`：32x32 canvas に角丸矩形＋mascot PNG（白背景を透過化）＋状態色 backing ＋隅ドットを描画し、`<link rel=icon>` を data-URL PNG に差替。`watch` で状態変化時に再描画。

## 方針（mulmoterminal — 差別化）

| | mulmoclaude | mulmoterminal |
|---|---|---|
| マーク | mascot PNG /「M」 | **`>_`（プロンプト＋カーソル）** |
| 状態 | 多数（running/done + 時間帯/誕生日/CPU…） | **3つ：idle / working / attention** |
| 背景 | 状態色で塗りつぶし | **ダーク端末（#1a1a2e）＋状態色の枠・グリフ** |
| 入力 | セッション一覧 | **pub-sub「sessions」全セッション横断**（grid 別dirも反映） |

- 状態優先度は既存セル（`TerminalCell` の status）に合わせ **attention(waiting) > working > idle**。
- 状態色：idle `#8a8aa0` / working `#4a8cff` / attention `#e0a030`。

## 変更

- `index.html`：`/favicon.svg`（不在）→ data-URL SVG の `>_`（idle色）に置換。404 解消＋JS前デフォルト。
- `src/composables/useDynamicFavicon.ts`（新規）：`FaviconState` 型、32x32 canvas に
  ダーク角丸＋状態色の枠＋`>`シェブロン＋`_`カーソルを描画→`<link rel=icon>` を差替。`watch` で再描画。
- `src/composables/useFaviconState.ts`（新規）：`usePubSub` で「sessions」購読、`Map<id,{working,waiting}>`
  を維持（`event:"closed"` で削除）、純関数 `deriveFaviconState` で状態算出、色を決め `useDynamicFavicon` 呼出。`onUnmounted` で購読解除。
- `src/App.vue`：ルートで `useFaviconState()` を一度呼ぶ（単一/グリッド両対応）。
- `src/composables/useFaviconState.spec.ts`：`deriveFaviconState` の純関数テスト（empty/idle/working/attention 優先・closed）。

## 確認ポイント

- favicon が `>_` マークで、mulmoclaude と一目で違う。
- 状態で色が変わる（idle灰 / working青 / attention琥珀）。
- attention が working より優先。
- 全セッション横断（grid 別dir含む）で反映。
- JS前は data-URL SVG（404 解消）。
