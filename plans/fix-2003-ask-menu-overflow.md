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

## 計画の前提が 1 つ間違っていた（実測で判明）

当初は「可変長なのは ask リストだけで、`RoundTableMenu` は固定高のフッタ」と考えていたが、
実ブラウザで測ると **`RoundTableMenu` の席チェックボックスもターゲット数ぶん並ぶ**。
19 ターゲットでの内訳:

| 部分 | 高さ | 可変か |
| --- | --- | --- |
| ask リスト | 798px（19 行 × 42px） | 可変 |
| 席リスト | 722px（19 行 × 38px） | **可変** |
| 操作部（turns / room / Start / watch） | 216px | 固定 |
| メニュー合計 | **1750px**（ビューポート 800px） | — |

つまり可変長のリストが 2 つある。フッタを丸ごと固定にする案は成立しない。

## さらに: CSS だけでは解決しない

上限を `max-h-[calc(100vh-5rem)]` で付けたところ、メニュー高さは 720px に収まり
リストもスクロールするようになったが、**Start はまだ画面外**だった（menuBottom 864 > 800）。
メニューはボタンにぶら下がって開くので、「許される高さ」と「下に収まる高さ」は別の数字で、
ビューポート単位は後者を知らない。最下段のセルでは後者がほぼゼロになる。

→ 開いた瞬間に計測して、**入る側に開き、その側の残りを上限にする**。
規則は `src/composables/menuPlacement.ts` に純粋関数として切り出す（ブラウザ無しで試験できる）。

## 直し方

兄弟をそのまま真似ると**メニュー全体**がスクロールする。それでも報告者の要求は満たすが、
このメニューだけは**可変長のリストと Start ボタンが同居**しているので、Start に触るたびに
19 行スクロールすることになる。一段良くする:

- メニュー: `flex flex-col overflow-hidden` + **開いた瞬間に計測した** `max-height`、
  余白が下に足りなければ `bottom-full`（上向き）に開く
- **2 つのリストをそれぞれ** `min-h-0 … overflow-y-auto` で包む
  （`cell-ask-list` と `round-table-seats`）
- 操作部は `flex-none` → **turns / room / Start は常に見える**

`min-h-0` が要点で、これが無いと flex 子要素は内容より縮まないため、親の max-height に
渡す余地が生まれない。縮むのはリストだけ、操作部は縮まない、という形になる。

報告者の「せめて round table に手が届くこと」と「スクロールして読めること」を両方満たす。

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
