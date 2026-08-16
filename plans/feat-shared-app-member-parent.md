# 名簿向けページの親を、両方のホストで同じものにする（P7）

**状態**: 実装済み（2026-08-16）。**sharedapp 0.7.0 の npm 公開待ち**
**日付**: 2026-08-16
**前提**: [`docs/shared-app-principles.md`](../docs/shared-app-principles.md)、
[`plans/feat-shared-app-preview.md`](./feat-shared-app-preview.md)（手元のプレビューは本番と同じ親を動かす）、
[`plans/feat-shared-app-member-write.md`](./feat-shared-app-member-write.md)（intent の語彙）

## 1. 出た形

エアロビクスジムの予約アプリを作っていた別のセッションが、こう報告した:

> クラス 224 / 申込み 1 / **viewer keys=[]** {} / bridge keys=[onState,ready,submit,transition,assign,withdraw]

そして「プラットフォームが `/p/` で `viewer` を空のまま渡している」と診断し、メールアドレスを
打たせて自分の申込みを絞り込む回避策を入れて公開した。

**診断は場所を間違えていた。** mulmoserver の `/p/` は `useAppIntent` が `{ me, can }` を作って
`AppViewFrame.vue` が state に載せる。空になる経路は無い。空だったのは **MulmoTerminal の
Collections ペインで見たとき**で、理由は 1 つ:

- ペインは `@receptron/sharedapp/view` の **`viewBridge`（公開ページ用）** を使っていた
- その state は `{ type, collections }` で、**`viewer` のキーが無い**（`bridge.ts`）
- 注入される runtime は `onState(data.collections || {}, data.viewer || {})`（`srcdoc.ts`）

つまり**プレビューで開いた名簿向けページは、例外なく空の `viewer` を受け取っていた**。ページは
ボタンを 1 つも描けず、その状態は「著者が capability の名前を間違えた」のと**画面上まったく
区別が付かない**。実際そう診断された。

## 2. これは既知の穴だった

`headlessReport.ts` が毎回のレポートにこう書いていた:

> The parent carrying `viewer` capabilities and answering the three intents lives in mulmoserver
> (`AppViewFrame.vue`) and is **NOT shared code yet** … Until that is lifted, the limit belongs to
> the Collections pane too, which is why it is **STATED** rather than worked around: a second
> parent written here would make the preview disagree with production, which is the one thing it
> must never do.

**言うだけでは足りなかった。** レポートを読むのは著者と、著者が使う LLM で、どちらも
「ここでは試されない」より先に「ボタンが出ない」を見る。書いてあることは、見えている症状に
負ける。

## 3. やったこと

3 リポジトリ、上流から順に。

### sharedapp 0.7.0

| | |
| --- | --- |
| `src/view/capability.ts` | `capabilityOf` / `capabilitiesFor` / `mayTransition` / **`viewerFor`**。mulmoserver から移設 |
| `src/view/intent.ts` | intent の読みと判断。同じく移設 |
| `src/view/intentMail.ts` | 遷移に乗る通知。同じく移設 |
| `src/view/memberBridge.ts` | **名簿・参加者向けページの親**（新規） |

**`viewBridge` にフラグを足すのではなく 2 本目の親にした。** 依頼の意味が違うため:
公開ページの submit は他人が新しいレコードを提案するもので、だから確認を挟んで訪問者が押す。
名簿の人の ask は既にあるレコードを動かすもので、射影に照らして判断し実行する。1 つにまとめると、
会員のボタンの前に押し直しの確認が挟まるか、`pending` が 2 つの意味を持つ。

**共有されるのはハンドシェイクで、呼び出しではなく同一であることによって共有する。**
ready への返事はチャネルだけ、データはポートに答えた文書を待つ — 理由は `bridge.ts` に全部ある。

**`viewerFor` を足したのは形の合意のため。** capability は既に共有されていたのに**包み**は
されておらず、それが `viewer.can.transitionAny`（`can` はコレクション id で引くので、どのアプリ
でも undefined）というページ側の不具合を生んだ。

### mulmoserver

`AppViewFrame.vue` から会話そのものが出ていき、DOM が要る部分だけ残った（iframe、sandbox、
メッセージが自分の frame から来たかの判定）。697 行削除。`ViewWrite` / `ViewMail` は package の
型の別名になり、**読み戻しの parse だけ残る** — 信用できない document を Firestore から読むのは
このホストの仕事で、コンパイラは壊れたものを見ない。

`perform` は **getter** で渡す。route が変わると prop が差し替わるので、値で掴むとアプリ B の
intent をアプリ A のハンドラで判断することになる。

### MulmoTerminal

- **サーバが `viewer` を解決する。** `preview.ts` が tier の射影と `handle.email` から
  `viewerFor` を呼び、ページごとに載せる。クライアントは射影も著者のアドレスも持たないので、
  射影を送って向こうで解決させるのは「2 つ目の実装」そのものになる
- `PreviewPage.viewer?: Viewer` を `common/` に足す（両端が決める wire shape なので）
- ペインは audience で親を選ぶ — 本番でアドレスが選ぶのと同じ判断
- **headless harness も同じ**。両方が「プレビュー」なので、片方だけ直すと次に同じ話になる
- `MEMBER_PAGE_LIMIT` を実態まで縮める

## 4. 残っている限界（意図的）

**プレビューは intent を実行しない。** ペインにも headless にも会員の書き込み用の経路が無いので、
`transition` / `assign` / `withdraw` は **`read-only` として名指しで拒否**される。

これは沈黙ではないことが要点で、語彙も直した: `READ_ONLY_ON_A_MEMBER_PAGE` は「**その控えは
配線されている**、おかしいことは何も起きていない」と読ませる。以前の
`NOT_A_SUBMISSION_ON_A_MEMBER_PAGE`（公開の親が intent を `not-a-submission` と答えていた頃の
文言）は、もう起きないので消した。

ペインに書き込みまでやらせるかは別の判断で、この計画には入っていない。ペインの Preview ボタンは
**公開フォームの submit** については実際に書くので、非対称ではある。

## 5. 順序

sharedapp → mulmoserver → MulmoTerminal。**途中でやめると本番とプレビューが食い違う**ので、
3 本通しで 1 つの作業として扱う。sharedapp 0.7.0 が npm に出るまで、下 2 つの CI は赤い。

## 6. 採らなかったもの

- **MT 側で `viewer` を組み立てる。** `headlessReport.ts` が明示的に禁じている通り、
  プレビューが本番と食い違うのは、このペインが最も避けるべきこと
- **`viewBridge` にフラグ。** 3 節に理由
- **mulmoserver の親をそのまま MT にコピー。** それが「2 つ目の実装」
