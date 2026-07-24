# fix: expand 時の view-toggle をヘッダー左端 → 右端（Settings 隣）へ

## User Prompt

> で、expand 時の view-toggleのぼたん、左じゃなくて右端にして。

## 背景

#771 で view-toggle（roster ⇄ strip）をグローバルヘッダーの**左端**（タイトル前）に置いたが、
右端が良いとの要望。

## 修正

`src/components/AppToolbar.vue` の view-toggle LauncherButton を、ヘッダー左端から
**右クラスタの Sound と Settings の間**へ移動（`v-if="showViewToggle"` は維持＝expand 時のみ表示）。
左端に付けていた `mr-1` は不要になり削除（右クラスタは gap 無しで隣接）。

## 検証

typecheck / build / lint(0 error) / GridView テスト（トグル結線）パス。
配置のみの変更で挙動・結線は不変。
