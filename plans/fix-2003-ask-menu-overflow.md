# fix #2003 — セルの forum メニューが画面外へ出てスクロールできない

## 問題

`TerminalCell.vue` の forum（ask）メニューのコンテナに **`max-height` も `overflow` も無い**:

```
absolute right-0 top-full z-20 mt-1 flex min-w-[180px] flex-col rounded-md border ...
```

中身の `askTargets` は `pickHandoffTargets`（`src/composables/useHandoff.ts:38`）が
**自分以外の全スロットを無制限に**返す。20 セルなら 19 行が並び、その下に積まれた
`RoundTableMenu` の設定と Start が画面外へ落ちる。`absolute` なので親のスクロールにも乗らず、
ホイールも効かない。報告者はブラウザのズームを 50% にして回避していた。

## これは設計判断ではなく取りこぼし

同リポジトリの他のドロップダウンは 3 つとも既に同じ対策をしている:

```
src/components/MulmoMenu.vue:103   … min-w-[180px] max-h-80 overflow-y-auto flex flex-col …
src/components/RunMenu.vue:56      … min-w-[180px] max-h-80 overflow-y-auto flex flex-col …
src/components/SkillMenu.vue:76    … min-w-[180px] max-h-80 overflow-y-auto flex flex-col …
```

forum メニューだけが漏れている。

## 直し方

兄弟をそのまま真似ると**メニュー全体**がスクロールする。それでも報告者の要求は満たすが、
このメニューだけは**可変長のリストと Start ボタンが同居**しているので、Start に触るたびに
19 行スクロールすることになる。一段良くする:

- メニュー全体に上限（`max-h-[...]`）+ `overflow-hidden` + `flex flex-col`
- **ターゲット一覧だけ**を包んで `min-h-0 flex-1 overflow-y-auto`
- `RoundTableMenu` はスクロール領域の**外**（`flex-none`）→ **Start は常に見える**

つまり「はみ出す分はリストが吸収する」形。報告者の
「せめて round table に手が届くこと」と「スクロールして読めること」を両方満たす。

上限値は `max-h-80`（320px、兄弟と同じ）では round table 部（約 200px）を引くと
リストが 4 行程度しか残らない。このメニューはフッタを持つぶん兄弟より背が高くてよいので、
ビューポート相対で `max-h-[min(70vh,560px)]` を採る。

## やらないこと

- **「席は最大 5 なのにメニューは全ターミナルを並べている」**（報告者も「別の話」と明記）。
  スクロールが付けば実害が消えるので、別イシュー。数を絞ると「どのセルと話すか」の
  選択肢を勝手に狭めることになり、それ自体が判断を要する。
- **最下段のセルでメニューを上向きに開く**。`top-full` 固定は全ドロップダウン共通の性質で、
  直すには開いた瞬間の計測と反転が要る。今回の「手が届かない」は上限＋スクロールで解消する。

## 検証

- **実ブラウザで見る。** jsdom はレイアウトを持たない（高さが常に 0）ので、
  overflow のバグは jsdom のユニットテストでは原理的に捕まえられない。
  アプリの**実際のビルド済み CSS** を読み込んだページに、同じクラスの markup を
  19 行ぶん描画して、①フッタ（Start）が可視 ②リストがスクロールする ③メニュー全体が
  ビューポートに収まる、を実測する。修正前後の両方で測って差を出す。
- コンポーネント spec で、スクロール領域が**リスト側**にあり `RoundTableMenu` が
  その外にあることを固定する（クラスの有無ではなく DOM の入れ子関係を見る）。
- `yarn format` → `lint` → `build` → `typecheck` → `test`。
