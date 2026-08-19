# 共有アプリ — メールアドレスを保存せずに「本人の行」を表す（`uidField`）

**状態**: mulmoserver の rules は **2026-08-19 に本番へ deploy 済み**（receptron/mulmoserver#215）。
sharedapp は **0.17.0 として npm 公開済み**（receptron/sharedapp#35、U8 / U9 込み）。
mulmoserver の**クライアント**は #216 でマージ済み。**MulmoTerminal はこのブランチ**（`feat/uid-field-host`）
**mulmoserver のブランチ**: `feat/uid-field-identity`（`firestore.rules` と `test/rules/rules_uidField.ts`）
**日付**: 2026-08-19
**前提**: [`docs/shared-app-principles.md`](../docs/shared-app-principles.md)（特に原則 4・5）、
[`plans/feat-shared-app-platform.md`](./feat-shared-app-platform.md)（「現在地 — ルールが実際に強制している語彙」の**身元**の行を、この計画が 1 つ増やす）

---

## 何が書けなかったか

きっかけは共有 TODO 板である。要件はこう:

- 最初はどの項目も未アサイン。**ログインした人なら誰でも**「自分にアサイン」できる（＝作業中）。
- 自分が作業中のものは**自分で外せる**。他人のアサインは触れない。
- 板には**誰がやっているか**が出る。
- 参加者を `members` に列挙したくない（名簿なし）。

最後の 2 つが両立しなかった。担当を表す行を公開すれば、その行の**全フィールド**が世界に読める
（原則 5 — 可視性の境界はドキュメントで、フィールドは隠せない）。そして担当者が誰かを
ルールが判定できる手掛かりは `emailField` しかないので、**名前を出すとメールアドレスも出る**。

`emailField` を宣言しなければメールは載らないが、今度は `ownRow` が常に偽になり、
**本人が取り下げることも完了にすることもできなくなる**（できるのは owner だけ）。
しかも publish はそれを止めず、`selfDelete` を書いたまま実行時に黙って何も許さない。

## なぜ uid で表せなかったか

ログインすれば uid は一意に定まる。にもかかわらず書けなかったのは、**ルールが uid を
ドキュメント id としてしか照合していなかった**からである。`firestore.rules` の
`request.auth.uid` の出現はデータ側では 2 つだけで、どちらも `idFrom`:

```
idFrom == "auth.uid"       && itemId == request.auth.uid
idFrom == "auth.uid+field" && itemId == request.auth.uid + "_" + resource.data[idField]
```

そして TODO 板は id を**タスク id**に使い切っている — 排他がそこに乗っている（原則 4）。
id は 1 つしかないので、**排他と本人性を同時に id に持たせられない**。本人性はフィールドに
落ちるしかなく、フィールド版が `emailField` しか無かった、というのが制約の正体である。
「メールが必要」だったのではない。

## 決定

### U1 — `public.submit.<cid>.uidField`、`ownRow` の末尾に 1 分岐

```
|| ("uidField" in s && s.uidField in resource.data && resource.data[s.uidField] == request.auth.uid)
```

`emailField` 分岐と対称で、違いは `verified()` を要求しないこと — uid は匿名サインインでも
存在し、既存の `auth.uid` 系分岐も要求していない（`ownRow` の先頭が `authed()` を見ている）。

**末尾に置くのは短絡のため。** 既存アプリは手前の分岐で答えが出るので、成功経路では
新しい式を 1 つも評価しない。全分岐が評価されるのは `ownRow` が**偽になる**経路
（`readWith` / `updateWith` の最後の `||`）だけで、そこが 1000 式の予算に対する唯一の負荷増である。

### U2 — create の束縛は公開経路だけ

`uidOk(s)` を `publicCreate` に置く（`authOk` の隣）。値は書き手自身の uid でなければならない —
でないと A が B の uid を書いた行を作れて、所有が最初から他人のものになる。

`createWith`（writer 経路を含む共通部）には**置かない**。理由は既存の `idOk` のコメントが
言っている通りで、**投稿者を名指す身元を、他人の行を代理入力するスタッフに要求できない**。
`emailField` の束縛が `authOk`（公開経路のみ）にあるのと同じ非対称である。

### U3 — uid は create 後に凍結する（writer を含む全員）

`uidHeld(s)` を `idHeld` / `stampHeld` の隣、`updateWith` の共通部に置く。

`emailField` とは**非対称**で、そこは意図的である。`emailField` はスタッフが付け替えられる
（受付が予約者のアドレスを直す）が、**uid は誰も手で入力できない**。付け替えの UI が
作れない以上、書き換えを許しても事故の入口が増えるだけである。

**帰結**: `uidField` を使うアプリでは、**owner でも担当の付け替えはできない**。できるのは
行を消して空けること（`selfDelete` か owner の delete）で、次の人が取り直す。
これは TODO 板の要件（「owner だけは他人のアサインを変更可能」）を**削る**方向の決定なので、
アプリ側にそう書くこと。

### U4 — `auth: "none"` との併用は無い

uid が存在しないので `uidOk` が常に偽になり、create が全部落ちる。ルールは fail closed で
正しいが、症状は「フォームが黙って全部拒否される」なので、**publish で拒否する**（sharedapp 側）。

### U5 — `uidField` は `selfUpdate` に入れられない

入れられると投稿者が自分の身元を書き換えられ、本人性が本人性でなくなる。
U3 の凍結が rules 側で既に殺しているので、これは**リンター依存ではない**（原則 2）。
publish 側の拒否は、黙って効かない宣言を早く読める言葉で止めるためだけにある。

### U6 — 読み戻しが「リストできる」側に入る

`uidField` はフィールドなので、`where(uid, ==, myUid)` のクエリがルールを通る。
合成 id の限界（`test/rules/rules_ownReadback.ts`）に当たらない側で、
公開ページの「自分の分」は**タスクごとの `view.mine` ではなく 1 クエリ**で解ける。

ただし mulmoserver のクライアント側（`ownForView` / `answers` / `mine` ポート）は
`emailField` と `auth.uid` 系しか知らないので、**別 PR**。ルールが許すことと、
ページに届くことは別である。

---

### U7 — 書き方は `.get(k, null)`、`in` + 添字ではない

両方の分岐で、フィールドの読み出しは `resource.data.get(s.uidField, null) == request.auth.uid`
と書く。`"k" in data && data[k] == uid` と同値だが（uid は非空文字列なので、フィールドが無い行は
それ自体で偽になる）、**式が 2 つ安い**。理由は下の実測にある — この 2 つが実際に境界を跨いだ。

---

## 既存アプリへの影響

**壊れない。** 分岐は `"uidField" in s` で守られ、既存の宣言にそのキーは無いので常に偽 —
評価結果は変わらない。方向も**広げる側**なので、今まで通っていた書き込みが落ちることはない。
既存アプリの**再 publish は不要**（マニフェストに触れない）。

唯一の実害になりうるのは **1000 式の予算**である。ルールは全アプリで 1 ファイル、関数は
呼び出し箇所にインライン展開され、超えると**ルールが動かなくなる**（漏れではなく、
自分の行すら読めなくなる — ファイル冒頭のコメントが警告している通り）。

### 実測（2026-08-19、emulator）

議論ではなく emulator に訊いた結果で、**書き方を 1 度変えさせた**ので残す。

- **最初の版（`in` + 添字）は境界を跨いだ。** `verifiedEmail` を宣言したアプリに**匿名セッションが
  create を投げる**経路で `maximum of 1000 expressions` に達し、拒否の理由が `authOk` ではなく
  **予算切れ**にすり替わった。変更前の rules で同じ書き込みを流すとこのメッセージは出ない
  （既存 162 本の全実行でも 0 件）ので、**跨がせたのはこの変更**である。
- **U7 の `.get(k, null)` で戻った。** 同じ経路でメッセージは消え、新しい 20 本を含む
  **182 本すべてが通り、予算メッセージは 1 件も出ない**。
- **余裕は「成功する経路」には十分あり、「拒否される経路」には無い。** `publicCreate` に
  no-op を 30 個詰めても**成功する create は 1 本も落ちなかった**（拒否側だけが予算切れに
  すり替わる）。逆に拒否経路は no-op **4 個で溢れる**。**評価エラー（匿名トークンに
  `email_verified` が無い）が短絡を止めるので、いちばん高いのは失敗する経路**である。

**次にここへ足す人へ**: 予算はまず**正しさの崖ではなく診断の崖**として現れる。テストは
`assertFails` のまま緑で通り、変わるのは理由だけなので、**`yarn test:rules` のログを
`1000 expressions` で grep すること**（0 件が基準線）。緑は根拠にならない。

`ownRow` は read / update / delete の全部に乗っているので、既存 14 本
（特にバッチ系の `rules_booking` / `rules_scenarios` / `rules_mail`）が通ることが、
既存アプリを壊していない証拠である。

## 出す順

**rules → deploy → sharedapp（npm）→ MulmoTerminal。** 逆にすると `uidField` を宣言した
アプリの publish が通り、実行時には `ownRow` が常に偽で何も許さない — エラーは出ない。
原則 2 の言う偽グリーンそのものである。

mulmoserver のルール deploy は**手動で CI が無く、どのリポジトリにも記録されない**ので、
deploy したらこの節に日付を書き足すこと。

- **2026-08-19** — `firebase deploy --only firestore:rules --project mulmoserver` 実行済み
  （PR receptron/mulmoserver#215 のブランチから。マージ前の deploy で、この repo の流儀通り）。
  コンパイル警告は 1 件だけで、既存の `idOk(s, aid, itemId)` の未使用引数（この変更とは無関係）。

### deploy 後に本番で確かめたこと / 確かめられないこと

**確かめたこと**（未サインインの REST、公開 API キー。既存アプリ `live-poll` に対して）:
`appSlugs/{slug}` が published として読める / `config/public` が読める /
`public.read` の `questions` が一覧できる / `votes` の一覧は `PERMISSION_DENIED`。
つまり**既存アプリの公開経路も拒否も、deploy 後に今まで通り**である。

**確かめられないこと** — `uidField` の本番での機能テストは**まだできない**。宣言を本番へ
運ぶ唯一の経路が publish で、その zod は strict なので `uidField` を持つ `app.json` を
**拒否する**（＝順序が守られている証拠でもある）。加えて `apps/{aid}` の create は
`verified()` を要求するので、匿名セッションで捨てアプリを作って試すこともできない
（そして**クライアントからアプリ文書は永久に削除できない** — `allow delete: if false`）。
本番での機能確認は **sharedapp が `uidField` を通すようになった後**、TODO 板を publish して
2 セッションで取り合う形で行う。それまでの根拠は emulator の 182 本である。

## U8 — reader が知らないキーである、という別種の非互換（版は**アプリごと**に決まる）

> **この節の結論（MAJOR = 2.0.0）は U10 で覆した。** 2.0.0 → 1.1.0 → **版を割り当てない**、
> と 2 段階で降りている。宣言ごとに刻印を決める仕組み（`protocolFor`）も一緒に消えた。
> ここは経緯として残す。結論は U10。

sharedapp を書いていて出てきた、rules だけ見ていたときには無かった話。

公開ページは `emailField` の欄を**セッションから埋め、フォームには描かない**。`uidField` も同じ
扱いが要る。ところが `uidField` は `createFields` に入っていなければならない（ルールがそう要求
する）ので、**このキーを知らない reader は「uid を打ってください」という入力を描く**。訪問者が
何か打ち、`uidOk` が拒否する。エラーは出ず、著者のブラウザでは動く。

最初これを **MINOR（1.1.0）+ 著者が floor を宣言**で済ませたが、**それでは止まらない**
（Codex の指摘）。reader は **MAJOR しか見ない**（mulmoserver の `protocolDrawable`）ので、
minor はどの reader も反応しない番号であり、floor を検査するのは **publisher** であって、
問題を起こすのはキャッシュされた他人のタブである。

**決定: 版はアプリごとに決まる。**

- `BASE_PROTOCOL = "1.0.0"` — 新しいキーを使わないアプリの刻印。**出力は今までと同一**。
- `UID_FIELD_PROTOCOL = "2.0.0"` — `uidField` を使うアプリの刻印。**新しい MAJOR**なので、
  キーを知らない reader は**半分描くのではなく、そのアプリを拒否する**。
- `protocolFor(app)` が宣言の中身から決める。**著者の floor からではない** — 刻印は
  「この文書が何を守っているか」の陳述で、使っていない機能を宣言しても新しい reader は要らない。
- floor 宣言（`protocol: "2.0.0"`）の要求は残す。役割が変わって、**著者が「どの契約に対して
  書いているか」を言う**もの — 古い publisher / 古い配備に対する門番であって、reader を止める
  のは刻印のほうである。

**帰結**: `uidField` を使うアプリは、mulmoserver の `SUPPORTED_PROTOCOL_MAJOR` が 2 になるまで
**描かれない**（拒否される）。これは正しい fail-closed で、順序が
rules → sharedapp → **mulmoserver client** → MT になる理由でもある。

## U9 — 記録を組み立てているのは sharedapp の view ランタイムである

これも Codex の指摘で、見落としていた。`@receptron/sharedapp/view` の `submit.ts` が
**両方のホストのために**記録を組み立てる（mulmoserver は `recordOf` を、MulmoTerminal は
`writableFields` と `recordOf` を使う）。`uidField` を知らないままだと、uid の入力が描かれ、
打たれた値がそのまま記録に載って `uidOk` に拒否される。

- `SubmitSpec.uidField` を追加、`writableFields` が隠し、`recordOf` が**アカウントの uid を
  後から入れる**（打たれた値は上書きされる）。サインインしていなければ**空文字ではなく欄ごと無い**。
- `writableFields` の**引数を宣言そのものに変えた**（`(drawn, submit)`）。以前は位置引数が
  伸びていて、新しい引数は任意 = **更新していないホストは黙って箱を描き続ける**。
  更新していないホストは**コンパイルで落ちるべき**である。MT の 2 箇所（`previewWrite.ts` と
  `preview.ts`）はこの変更で直す必要がある。

## U10 — 版そのものが要らなかった（`1.0.0` のまま）

4 本すべてマージしたあとに出た問い —— この段階で major を使うのは重すぎないか。調べ直したら、
**U8 の前提そのものが間違っていた**。「minor はどの reader も反応しない番号だから、古いタブは
uid の箱を描いて全部拒否される」というのが根拠だったが、**古いタブはそもそもこのアプリを
描かない**。

実測した。todo-board テンプレートを実際に投影し（sharedapp 0.17.0 + MT の `publicFormOf`）、
`protocol` を `"1.0.0"` に書き換えて mulmoserver #216 **以前**の `publicConfigFrom` に食わせた:

```text
OLD READER REFUSED: UnsupportedProjection - this app was published in a shape this release does not read
CONTROL（createFields から uid を抜いたもの）: drawn
```

偶然ではなく構造的で、三つが同時に成り立つから起きる:

- ルールは `request.resource.data.keys().hasOnly(createFields)` しか受け付けない
  → uid は **`createFields` に必ず入る**（入っていない宣言は publish が拒否する）
- 描かないことが機能そのもの → uid は **`form.fields` に絶対に入らない**
- `publicFormOf` は描く欄がゼロでもコレクションの form エントリを残す
  → `consistent` の「form に無い cid は素通し」に**逃げない**

古い `agrees` が「ホストが埋めるから描かれなくてよい」と数えるのは email / status / stamp の
**3 つだけ**なので、`uid` が残って整合検査に落ちる。**major が買う画面を、major より 1 世代前の
検査が既に出していた。**

**major が余分に覆う面が 1 つだけある。** member / participant のティア設定は `submit` を運ぶが
`form` を運ばないので、突き合わせる相手がいない（`memberViewChoice` は `protocolDrawable` でしか
拒否しない）。古いビルドは uid アプリの `/m/{slug}` を描いてしまう。ただし書き込みは `uidOk` /
`uidHeld` が拒否し、own スコープの読みは `where(uidField, "==", uid)` を付けられないので
ルールが拒否する —— **押しても効かないボタンが名簿の人に見えるだけ**で、uid の偽装も漏れもない。
見るのは owner が入れた既知の人だけで、見知らぬ人が来る公開ページは構造的に拒否される。
全 uid アプリを全ての古いリーダーで永久に拒否させる対価としては高い、と判断した。

### では minor は要るのか —— 要らなかった

ここで一度 `1.1.0` に落とし、「番号が効いているのは**書く側**（古い publisher が `uidField` を
黙って落として、uid が誰にも束縛されていない板を公開してしまうのを floor が止める）」と書いた。
**これも間違いだった。** キー導入前のビルド（`cd37037^`）に uid の `app.json` を食わせて実測した:

```text
--- floor 宣言なし:   REFUSED   public.submit.claims: Unrecognized key: "uidField"
--- floor 1.1.0 あり: REFUSED   public.submit.claims: Unrecognized key: "uidField"
```

`SubmitZ` は `.strict()` である。**知らないキーはスキーマで落ちる**し、その検査は
`protocolProblems` より**先**に走るので、floor を宣言してもしなくても結果もメッセージも同じ。
floor は何も買っていなかった。

版を読む相手を数え直すと、4 系統すべてが 1.0.0 と 1.1.0 を区別しない:

| 見る相手 | 差 |
|---|---|
| 読む側の門 `protocolDrawable` | major しか見ない → 同じ |
| 読む側の分岐 `protocolAtLeast` | 分岐が 1 つも無い → 同じ |
| 著者の floor `protocolProblems` | 知らないキーには走らない（上） → 同じ |
| 人・診断 | `submit.<cid>.uidField` が刻印の 3 行隣に載っている → 同じ |

最後の 1 行が、この件のいちばん効く指摘だと思う。**刻印は宣言から導かれる値で、その宣言は同じ
文書の中にある。** 導出元の隣に導出結果を書いても、情報は 1 ビットも増えない。

**決定: `uidField` に版を割り当てない。** `APP_PROTOCOL = "1.0.0"` の 1 定数に戻し、
`UID_FIELD_PROTOCOL` / `protocolFor` / `protocolFloorProblems` を削除する。

消えるのは **uid 専用の floor 要求**（`uidField` を使うなら `protocol` を上げて宣言しろ）
だけである。**`app.json` の `protocol` そのものは残る** —— 全テンプレートが宣言している
`"1.0.0"` は据え置きで、todo-board もそれに揃える（`skillTemplates.spec.ts` が全テンプレートを
`APP_PROTOCOL` と突き合わせて固定する）。宣言をやめるのではなく、**機能ごとに違う番号を
書かせるのをやめる**、が正確な言い方である。

**版の仕組み自体は残す。** キーの**追加**は strict なスキーマが fail-closed にするが、
**既存キーの意味が動く**変更は未知のキーが無いので、スキーマには見えない。そのときだけ
`protocolProblems`（ceiling を超える floor の拒否）と major が要る。

**出す順は U8 と逆**（リーダーが**最後**）: sharedapp 0.18.0 の publish → MulmoTerminal →
mulmoserver。`2.0.0` で publish されたアプリは存在しない（uid アプリはまだ作られておらず、
ホストも再ビルド前）ので、無傷で回収できた。

**この判断が乗っている不変条件はテストで固定した**（`test/server/backends/publicForm.spec.ts`）。
uid が `createFields` にあって投影フォームに無いことが崩れると、古いリーダーは黙って描き始める
—— 番号は何も守っていないので、崩れたことに気づく手段が他に無い。

## やり残し

- **mulmoserver（クライアント）** — #216 で完了（マージ待ち）。実装して分かったのは、
  「読める」が **4 つ**だったこと: major 2 を描く / uid の箱を描かない / `SUBMIT_OPTIONAL` に足す /
  `ownLookup` が uid で引く。**4 つ目と 3 つ目は同じキーの表と裏**で、`agrees`（createFields と
  描画フォームの一致検査）が uid を「描くべき欄」と数えると、**投影ごと不整合になって
  訪問者はページそのものを得られない**。落とすのと数えるのは別の壊れ方で、どちらも黙っている。
- **MulmoTerminal** — 済（このブランチ）。`writableFields` の新しい引数、`scopedFields` の実在検査、
  公開フォーム投影から uid を外すこと、プレビューの own スコープと書き込み、スキルの
  `templates/todo-board.md` と身元の選び方、`docs/shared-app-principles.md` の原則 5 への追記。

  実装して分かったこと 2 つ:

  - **テンプレートの `protocol` を「全部 1.0.0」で固定していたテストがあった**。版がアプリごとに
    なった以上そこは `protocolFor(宣言)` で訊くしかなく、リテラルのままだと**使ってもいない
    契約を 5 つのサンプルに貼る**方向で「直る」— それは全アプリに古い reader を拒否させる宣言を
    教えることになる。
  - **公開フォームから uid を外すのは MT 側**（`publicForm.ts`）。mulmoserver 側で描画時に飛ばす
    のとは別で、両方要る — 前者が無ければ世界に読める文書に uid のラベルが載り、後者が無ければ
    古い版で描かれる。
