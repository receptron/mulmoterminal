# feat: グリッド拡大時にヘッダ余白クリックで別ターミナルへ切替

Issue: #252

## User Prompt

> single viewの拡大時に、下にあるターミナルって簡単に切り替えできる？
> （…toggleExpand で別セルの ⤢ を押せば直接切り替わる、と説明）
> あ、ここで切り替わるのか。このボタンが見えないようだ。
> ヘッダ地の余白クリック → そのセルをズーム（＝切替）。でいこう

## 背景 / 問題

グリッドでセルをズームすると、そのセルが上に teleport され残りは下のフィルムストリップに並ぶ。
別ターミナルへ切り替えるにはストリップ各セルのヘッダの ⤢ ボタンを押す必要があるが、狭いセル
（260px）ではヘッダ内容で右端のアクション（⤢/✕）が押し出され **⤢ が見えず切り替えに気づけない**。

## 方針

**ヘッダ地（余白）クリックでそのセルをズーム（＝切替）**。`toggleExpand` は未拡大セルを指定すると
直接そのセルへ差し替えるので、ストリップセルのヘッダクリック＝切替になる。

- 共有純関数 `shouldZoomOnHeaderClick(target, expanded)`（`src/components/cellHeaderZoom.ts`）:
  - 拡大中セルは `false`（誤解除しない。解除は ⤡ ボタン）
  - クリックがヘッダ内ボタン（`closest("button")`）なら `false`（dir/GitHub/⤢/✕/◀▶ は従来動作）
  - それ以外（余白・prompt・badge・dot）は `true` → `toggle-expand`
- Terminal / Launcher / Command の3セルに配線（`@click` ＋ 未拡大時 `is-zoomable` クラス）。
- カーソル pointer ＋ hover 背景で押せることを可視化。
- 端末本体は不変（選択・入力と競合しない）。

## 変更

- `src/components/cellHeaderZoom.ts`（新規・純関数）＋ `cellHeaderZoom.spec.ts`。
- `TerminalCell.vue` / `LauncherCell.vue` / `CommandCell.vue`: import ＋ `onHeaderClick` ＋ ヘッダ
  `@click`/`is-zoomable` ＋ CSS。

## 確認ポイント

- ズーム中、下のストリップセルのヘッダ余白クリックで即そのセルへ切替。
- ヘッダ内ボタン（dir/GitHub/⤢/✕）はクリックしてもズーム切替せず従来動作。
- 拡大中セルのヘッダクリックは no-op。
- 端末本体クリックは端末操作（切替しない）。
