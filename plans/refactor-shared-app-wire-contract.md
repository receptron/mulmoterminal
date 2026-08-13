# 共有アプリ: 射影を MulmoTerminal に引き取り、ワイヤ契約を独立させる

**状態**: **決定 1 は実装済み**（2026-08-13）。射影の書き込み側は MulmoTerminal
`server/backends/sharedApp/appViewProjection.ts` に移り、core からは消えた
（mulmoclaude PR / `@mulmoclaude/core@4.0.0`、MT PR）。
**決定 2〜4（ワイヤ契約のリポジトリ）は未着手** — 置き場所と名前が未決のため。
下の「リポジトリ横断と依存順」の 1 と 2 が済み、3 と 4 が残っている。
[`feat-shared-app-member-write.md`](./feat-shared-app-member-write.md) を出した直後の
振り返りから出た。前提は [`docs/shared-app-principles.md`](../docs/shared-app-principles.md)、
決定は [`feat-shareable-collections.md`](./feat-shareable-collections.md) の D1–D10。

---

## 何が問題か

`{tier}/config` の射影を 1 フィールド増やすのに、3 リポジトリと **npm publish の
人間ゲート**を通る。直近の `writers` / `rowWriters` はこうだった:

1. mulmoclaude#2891 で `@mulmoclaude/core` を直す → CI → マージ → **npm に publish**
2. mulmoterminal で core を bump
3. mulmoserver は読み手を手で書く

publish は人の操作なので、2 と 3 は「待ち」になる。しかも `publishProject.ts` は
直近 60 日で 15 コミットあり、この経路は**今後も繰り返し通る**。

## 先に確かめたこと

計画の形はここで決まった。当初「MulmoClaude も同じドキュメントを書くので分けられない」
と考えていたが、**二重に誤り**だった。

**MulmoClaude は共有コレクションを書かない。**
`projectApp` / `projectAppViews` の呼び出しは `packages/core` の外に 1 件も無い
（あるのは core 自身のテストだけ）。core 自身がそう書いている —
`packages/core/test/collection/test_sharedHostSurface.ts` の冒頭:

> Shared collections are hosted by MulmoTerminal, which owns the operations
> (deploy / publish / unpublish), their write ORDER, and the tool the agent calls.
> This package owns the pure parts.

**MulmoClaude は読みもしない。**
`setSharedCollectionsSupport(true)` を本番で呼ぶのは
`server/backends/sharedCollections.ts:36`（MT）だけで、mulmoclaude 側の出現は全部テスト。
既定は false、`discovery.ts:141` はその時点で共有コレクションを **refuse** する
（skip ではなく理由付きで拒否）。したがって `uiHost.ts` の `collection:app/<aid>/<cid>`
購読は MulmoClaude では `appId` が届かず、死んだ枝でいる。

**rules のラウンドトリップテストは、churn している側を踏んでいない。**
mulmoserver `test/rules/rules_publish.ts` が import するのは `projectApp` と
`AuthoredAppZ`。そして **`projectApp` は `projectAppViews` を呼ばない** — 別の入口
（`publishProject.ts:675`）で、`projectApp` が作るのは app ドキュメント /
`config/public` / schemas、emulator に流れるのもその 3 つだけ。

**`projectAppViews` の呼び出し元は全リポジトリで 1 箇所**、
`server/backends/sharedApp/appViews.ts:108`（MT）。

**MS が core を型だけで使う先例は既にある。**
`import type { RemoteViewMutateRequest } from "@mulmoclaude/core/remote-view"`、
`import type { Channel, Command } from "@mulmoclaude/core/remote-host"`。
`commandChannel.ts:5` に「The command-channel protocol types are owned by
@mulmoclaude/core」と書いてある。共有ワイヤ型はこのリポジトリ群で確立した形。

---

## 決定 1. 移すのは射影の**書き込み側**だけ。ゲートと `projectApp` は core に残す

`appViews.ts` は上下で性格が違い、そこが線になる。`publishChecks.ts`（ゲート）が
import しているのは `normalizeViews` / `participantScope` / `NormalizedView` の 3 つだけで、
`writeFor` は使っていない。

**core に残す** — `normalizeViews`、`participantScope`、`NormalizedView`、
`ProjectedViewCollection`、`VIEW_AUDIENCES`、`VIEW_ID_PATTERN`、および
`projectApp` / `projectDeploy` / `projectPublish`。
理由は 1 つ: **`rules_publish` が守っているのはこちら側**だから。ここを動かすと、
射影とルールの一致を証明できる両リポジトリ唯一のテストが被写体を失う。

**MT に移す** — `ProjectedViewWrite`、`writeFor`、`AppViewConfigDoc`、および
`publishProject.ts` の `projectAppViews` / `tierConfig` / `tierWrites` / `tierViews` /
`tierSubmit` / `PromotedRuleConfig`。**`feat-shared-app-member-write.md` で触ったのは
この一覧そのもの**で、rules テストの守備範囲の外にいる。

受け皿は既にある（`server/backends/sharedApp/appViews.ts`）。**新しい依存は増えず、
mulmoserver は無変更、MT → MulmoClaude の依存もそのまま。**

## 決定 2. 共有するのは「型」ではなく**ワイヤ契約**。ロジックは入れない

型だけを共有しても、実際に出たバグは捕まらない。MS の読み手は
`writeOf(value: unknown): ViewWrite | null` で**入口が `unknown`** なので、
境界では何も型検査されない。共有型が効くのは「MT がフィールドを改名／削除したのに
MS が読み続けている」ケースだけで、`rowWriters` が「空配列」か「配列が無い」か、
どの階層が fail closed か、という**意味**の側には一言も触れない。

新パッケージの中身を 3 つにする:

1. **形** — append-only な interface 群。意味の規則（absent ≠ `[]`、階層ごとの
   fail closed の向き）を doc コメントで併記する。**バグはここに出たので、ここに書く。**
2. **定数** — パス、tier id、フィールド名の文字列リテラル。MS の寛容なパーサが
   MT と同じリテラルを参照できるようにする。
3. **ゴールデン文書** — 実際の `app.json` から MT が生成した `{tier}/config` を数本
   コミットしておく。MT 側のテストが再生成して diff、MS 側のテストがそれを
   `writeOf` / `capabilityOf` に食わせ、期待する能力が出ることを assert する。

3 番が本体。改名は MT 側の golden diff で落ち、読み違いは MS 側の assertion で落ちる。
`rules_publish` が「射影 ↔ ルール」に対してやっていることを、
「射影 ↔ 読み手」に対してもう一段上でやる形。**この穴は今もあり、
決定 1 だけでは塞がらない。**

**射影器（`writeFor` など）を契約に入れないこと。** 入れた瞬間、両者がランタイムで
バージョンを合わせる必要が生まれ、逃げたはずの publish ゲートに戻る。
契約であってライブラリではない。

## 決定 3. 形は **append-only・全部 optional**。ドキュメントは非同期な持続物

3 か月前に publish されたアプリは、その日の形のまま Firestore に居座り、誰かが
publish し直すまで書き換わらない。**MS は過去の MT が書いた全部を読む必要があり、
共有型は今日の MT しか説明しない。**

`ProjectedViewWrite` は `cid` 以外すでに全部 optional なので、その性質は保たれている。
厳密な同期インターフェースにした瞬間、この型は嘘をつき始める。
**MS の読み手は寛容なまま**にしておくこと — 共有型が固定するのはパーサの出力であって、
入口ではない。

なお MS が core を 3.7.0 で固定したまま平気なのは、型が消えるので**古くても
何も壊れないから**。新しい契約パッケージも、片方だけ静かに古くなる。
ゴールデンがあるとその古さが**テストとして落ちる**、というのが 3 番目の効用。

## 決定 4. 置き場所は独立リポジトリ、**git ref 依存**。npm を通さない

型 + JSON だけならビルドが要らない。両側が
`"…": "github:receptron/<name>#<sha>"` で参照し、sha を bump する。
**mulmoclaude の monorepo には置かない** — まさに避けたい npm リリースを相続するため。

MulmoClaude は共有コレクションを読みも書きもしないので、このパッケージに関与しない。
名前に `mulmoclaude` スコープを付けないほうが所有関係を誤らせない。

---

## 実装して分かったこと（決定 1）

**`tierSubmit` は `projectSubmit` に依存していて、それは core に残る側だった。**
計画の移動リストに入っていなかった。`public.submit` の window を ISO からミリ秒に
落とす変換で、同じ宣言が `config/public`（ルールが読む・`rules_publish` が守る）にも
射影される。二重実装は**申し込み期限が黙って閉じなくなるまで誰も気づかない**種類の
食い違いなので、core から **export して共有**した。移動を 1 個増やすのではなく、
逆向きに 1 個公開する形になった。

**`test_sharedHostSurface.ts` から減らすものは無かった。** あの一覧に
`projectAppViews` は載っていなかった（MT が import しているのに）。代わりに、
移動後に MT が実際に import する分 — `normalizeViews` / `participantScope` /
`projectSubmit` / `viewDocId` / `viewConfigDocId` / `VIEW_TIER` — を**足した**。
併せて「射影はここに戻ってこない」ことを `publishApp` と同じ形の否定テストで固定した。

**core は 4.0.0（メジャー）。** export を削るので semver 上そうなる。消費者は MT だけ。

**`.sort()` は MT の lint（`sonarjs/no-alphabetical-sort`）に引っかかる。**
`localeCompare` にはできない — この配列は Firestore に publish され順序で比較されるので、
機械によって順が変わると「何も変えていない publish」が文書を書き換える。理由を書いて
disable した。

## リポジトリ横断と依存順

決定 1 と決定 2 は**独立に出せる**。1 は依存が増えないので単体で先行できる。

1. **[済]** **MT**: `writeFor` と tier 射影を `server/backends/sharedApp/` に引き取る。
   core からの import を減らす。MT のテストで射影を固定する（今は core 側にある）。
2. **[済]** **core**: 移した分を削る。`test_sharedHostSurface.ts` の一覧から該当分を外す
   （あのファイルは「ホストが戻ってこなくて済むか」を測る装置なので、**減るのが正しい**）。
   `projectApp` 側は無変更。
3. **[未]** **契約リポジトリ**: 形 + 定数 + ゴールデンを置く。
4. **[未]** **MT / MS**: 契約を git ref で参照し、それぞれ生成側 / 消費側のテストを足す。

1 と 2 は 1 回の core リリースを使う（**削るための最後の publish**）。以後、
`{tier}/config` の変更に core リリースは要らなくなる。

## やらないこと

- **`firestoreStore.ts` / `firestoreDocs.ts` は動かさない。** `store.ts` / `host.ts` に
  組み込まれた汎用の Firestore バックエンドで、共有アプリ専用ではない。
- **`paths.ts` は分割しない。** core 中が import していて churn しない。
  MT からはそのまま使う。
- **`projectApp` / `projectDeploy` / `projectPublish` は移さない**（決定 1 の理由）。
- **mulmoserver → MulmoTerminal の依存は作らない。** 決定 1 の切り取り線なら不要で、
  作ると CLI 全体が MS の dev ツリーに入る。
- **MulmoClaude アプリ（`src/` / `server/`）には何も足さない・引かない。** 共有コレクションに
  関与していない。変わるのは同じリポジトリに同居する `packages/core` だけ。

## 開いている問い

- **ゴールデンの更新をどちらの CI が走らせるか。** MT の PR で golden が変わったとき、
  MS 側の bump が要ることを何が知らせるか。契約リポジトリの CI から両者に issue を
  立てるのか、MS の定期ジョブで sha 差を見るのか。
- **契約のバージョニング**: sha 固定か tag か。tag だと「リリース」が復活しかねない。
- `VIEW_TIER` / `viewDocId` / `VIEW_CONFIG_ID` を契約に移すか core に残すか。
  MS は今これらを手で写している（`sharedAppShape.ts:7` に「mirrored here」とある）。
- 名前。
