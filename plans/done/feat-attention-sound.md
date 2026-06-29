# Plan: 入力待ちの音通知＋ヘッダ色での状態表示

Issue: #85（#46 の req6）
作成日: 2026-06-21

## ゴール
- 端末が **`waiting`（入力待ち）** になったら**音**で通知（全セッション対象・裏ページ含む）。
- グリッドセルの**ヘッダ色**でも状態（waiting/working/idle）が分かる。

## 音
- セルと同じ「sessions」pub/sub の push を**直接購読**（`useSessions` の再取得リストではなく、色と同一ソース）。
- **鳴動条件 = そのセッションが「あなたの番」になった瞬間**: `working` が **true→false**（claude がターン終了＝Stop。全セッションで publish）または `waiting` が false→true（許可/質問。背景セッションのみ立つ）。
  - 当初「waiting のみ」だったが、サーバ実装上 `waiting` は **foreground セッションには立たない**（Stop で working=false になるだけ）ため、foreground でも鳴らすには `working` の立ち下がりを見る必要があった。
- 初回 push はベースライン（鳴らさない）。push は delta（変化時のみ）でスナップショット replay 無し。
- **🔔トグル**: `useSoundEnabled`（localStorage `sound_enabled`、デフォルト ON）。App.vue と GridView 両方。
- **🔊テストボタン**: チャイムを即再生（兼オーディオ解錠）。AudioContext は初回ユーザー操作で解錠。

### 実装
- `src/composables/useSoundEnabled.ts`: localStorage 同期の singleton ref ＋ toggle。
- `src/composables/useAttentionSound.ts`: `useAttentionSound(enabled)` が「sessions」を購読してビープ。純関数 `needsAttention(prev, msg)` を分離（テスト可能）。`playAttentionSound()` を export（テストボタン用）。
- `App.vue`: `useAttentionSound(soundEnabled)` ＋🔔/🔊ボタン。
- `GridView.vue`: 🔔/🔊ボタン。

## ヘッダ色
- `TerminalCell` の `.cell-header` に `statusClass`（既存）を付与。
- CSS: `.cell-header.is-waiting`（琥珀の枠／薄い背景）/ `.is-working`（青みがかり）/ `.is-idle`（無色）。ドットは据え置き。

## テスト
- `useAttentionSound.spec.ts`: `needsAttention` の遷移検出（ターン終了 working true→false で発火・waiting false→true で発火・初回ベースライン無音・作業継続/開始で無音・セッション独立）。

## スコープ外（別issue）
- req8: 裏タブ（ページ）の集約バッジ。
