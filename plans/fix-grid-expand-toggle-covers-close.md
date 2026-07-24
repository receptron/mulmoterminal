# fix: expand 時の view-toggle を撤去し、グローバルヘッダー左端へ移設

## User Prompt

> あれれ、expand時のボタンを移動したせいで、今度は閉じられなくない？
> expandひだりうえ！！じゃなくて設定とかあるglobalヘッダーの一番左に於けば良い。不要なときは隠して。

（#769 で `.stage { position: relative }` を入れた直後の回帰 → 位置の作り直し）

## 背景 / 症状

- #768/#769: grid+expand 時に view-toggle（`☰`/`▤`）が設定歯車を覆う → `.stage { position: relative }` で解決。
- その副作用で toggle の絶対配置基準が viewport→`.stage` になり、今度は **zoom セル右上の ✕ 閉じる/⤡ 展開ボタン**を覆って閉じられなくなった（回帰）。
- stage 左上へ逃がす案（PR #771 初版）も、コックピット先頭行に重なりユーザー却下。

## 方針（確定）

toggle を stage から撤去し、**グローバルヘッダー（AppToolbar）の一番左**へ移設。expand 時のみ表示、非 expand 時は隠す。
toggle は元々「左サイドパネル（コックピット⇄ストリップ）の表示切替」なので、他のビュー系ボタンと同じヘッダーに置くのが自然。

## 実装

- **TerminalGrid.vue**: stage 内の absolute トグルを削除。`listMode` をローカル ref → **prop 化**（source of truth は親）。`list-mode` emit と `.stage { position: relative }` を撤去（元の stage に復元）。
- **GridView.vue**: `listModeOn` を source of truth 化。`toggleListMode()`（反転＋poll 同期）を追加。AppToolbar へ `:show-view-toggle="expandedUid !== null"` `:list-mode` を渡し `@toggle-view`。TerminalGrid へ `:list-mode="listModeOn"`。
- **AppToolbar.vue**: props `showViewToggle` / `listMode`、emit `toggle-view`。ヘッダー左端（タイトル前）に `v-if="showViewToggle"` の LauncherButton（roster=`view_agenda` / strip=`view_carousel`）。

## テスト

- TerminalGrid.spec: トグルクリック依存のテストを **`listMode` prop 駆動**へ。削除した `list-mode` emit のテストを除去。mount ヘルパーに `listMode` 追加。
- GridView.spec: **結線テスト**を追加（expand 時のみ toggle 表示 / `toggle-view` で grid の `listMode` が反転）。ミューテーション（grid の `:list-mode` を定数化）で赤くなることを確認済み。

typecheck(app) / build / lint（0 error）/ grid・gridview テスト（30件）パス。実レイアウト再現で閉じる/歯車の露出も確認済み。
