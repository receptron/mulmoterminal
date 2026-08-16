# サーバ時刻のフィールドが、書かれた瞬間に自分のスキーマに適合しなくなる

**状態**: P0 済み（2026-08-15）、D2 決定。P0b 以降は未着手
**日付**: 2026-08-15
**前提**: [`docs/shared-app-principles.md`](../docs/shared-app-principles.md)、
[`plans/feat-shared-app-preview.md`](./feat-shared-app-preview.md)（手元のプレビューは本番と同じ親を動かす）、
`server/skills/mulmoterminal-shared-app/templates/gym.md`（先着枠。`stampField` が設計の中心）

この計画が答える問いは 1 つ:

> **`stampField` に宣言したフィールドは、公開フォームから 1 件書かれた時点で、
> そのコレクション自身のスキーマに適合しなくなる。**

そして調べていくと、被害はそこではなかった。**同じフィールドを、ページと表と検査が
それぞれ違う形で受け取っている** — 同梱テンプレの先着枠が、それで動いていない。

---

## 1. 実地で出た形（2026-08-15、アンケートアプリ）

`public.submit.responses.stampField: "submittedAt"`、スキーマは `"submittedAt": { "type": "datetime" }`。
公開ページから 1 件投稿した直後:

```
getItems: 'submittedAt' = 'Timestamp(seconds=1786835154, nanoseconds=605000000)'
          is not a YYYY-MM-DDTHH:MM datetime
publish:  1 existing record would not satisfy the schema about to be written
```

`string` に変えると、今度は別の門が止める:

```
publish: stampField names 'submittedAt', which is a 'string' field. What the rules write
         there is `request.time`, a timestamp — declare it as `datetime`
```

**輪になっていて、出口は `confirm: true` しかない。** そこを通ると、恒久的に不適合な
レコードを抱えたまま公開され、以後の deploy と publish が毎回同じ理由で止まる。

## 2. コードで確認した 3 つの事実

**(a) 書かれる値は Firestore の `Timestamp` で、これは動かせない。**
`@receptron/sharedapp` の `src/view/submit.ts:130` が `stampField` に `serverTime()`
（両ホストとも `serverTimestamp()`）を入れる。ルールは
`request.resource.data[stampField] == request.time` を要求する — 文字列は `request.time`
と等しくならないので、**ここを文字列にするとルール側で全部拒否される**。
順位の偽装を防いでいるのがこの比較なので、ルールを緩めるのは先着枠の設計を捨てることと同じ。

**(b) `datetime` の意味は「`YYYY-MM-DDTHH:MM` の文字列」。**
`@mulmoclaude/core` の `strictTypeProblem` → `parseIsoDateTime`。厳格なのには理由があって、
カレンダー/`triggerField`/`spawn` が黙って落とす値をそのまま弾いている（`Z` 付きも拒否）。

**(c) MulmoTerminal の 2 つの門が、互いに反対のことを要求している。**

| 門 | 要求 |
| --- | --- |
| `server/backends/sharedApp/scopedFields.ts:136` | `stampField` は `datetime` でなければならない |
| `server/backends/sharedApp/records.ts`（移行ゲート、D10） | その `datetime` に入っている値は `datetime` ではない |

どちらも正しい。噛み合っていないのは **`datetime` という 1 つの語が、宣言の側では
「サーバ時刻を置く場所」を、検査の側では「`YYYY-MM-DDTHH:MM` の文字列」を指している**こと。

## 3. 本当の被害 — 1 つの値が 4 つの形で読まれている

`Timestamp` は `toString()` が `Timestamp(seconds=…, nanoseconds=…)`、`toJSON()` が
`{ type: "firestore/timestamp/1.0", seconds, nanoseconds }`（SDK の実装で確認）。
そして**どのリポジトリにもこれを復号している場所が無い**（`firestore/timestamp` の grep が
mulmoterminal / mulmoserver / core / sharedapp のいずれにも当たらない）。

| どこ | 経路 | ページ・検査が実際に見る値 |
| --- | --- | --- |
| 本番の `/m/{slug}` `/p/{slug}` | `mulmoserver/src/utils/viewChannel.ts` の structured clone | `{ seconds, nanoseconds }` |
| ペインのプレビュー | HTTP の JSON（`Timestamp.toJSON()`） | `{ type: "firestore/timestamp/1.0", seconds, nanoseconds }` |
| headless preview | `JSON.stringify` → `page.evaluate` | 同上 |
| コレクションの表・`manageCollection`・移行ゲート | 生の `Timestamp` インスタンス | `Timestamp(seconds=…)` |

**プレビューと本番が一致していない。** これはプレビュー機能が唯一やってはいけないこと
（`feat-shared-app-preview.md`「採らなかったもの」）で、しかも壊れ方が同じなので誰も気づかない。

そして結果として:

### 同梱テンプレの先着枠は、順位を時刻で決めていない（P0 で実測、3b）

`stampField` を宣言している同梱テンプレは `gym.md` だけで、その `mine.html` が並べているのはまさにその値:

```js
.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
```

`createdAt` は `Timestamp`（本番では clone された `{seconds, nanoseconds}`）なので、
`String(...)` は**全行 `"[object Object]"`**。比較は常に 0 になり、`Array.sort` は安定なので
実際に出る順位は入力順 — つまり `orderBy("__name__")`、**ドキュメント ID の順**
（`idFrom: "auth.uid+field"` なので、実質ランダム）。

「定員を保存せず順位から導く」という設計そのものが、ここで成り立っていない。
**もっともらしい順位が出るので、画面を見ても分からない。**

> **P0 で測った（2026-08-15）。推論ではなくなった** — 下の「P0 の結果」を見ること。
> 実アプリでの端から端までの確認だけが残っている。

## 3b. P0 の結果（2026-08-15、実測）

本物の `Timestamp` を 1 個作り、4 つの経路が実際に何を渡すかを走らせた。表の値はすべて出力。

```
production (structuredClone): {"seconds":1786835154,"nanoseconds":605000000}  ctor: Object
JSON (toJSON):                {"type":"firestore/timestamp/1.0","seconds":…,"nanoseconds":…}
String(raw):                  Timestamp(seconds=1786835154, nanoseconds=605000000)
String(cloned):               [object Object]
String(JSON round trip):      [object Object]
```

**(1) 先着枠は時刻で並んでいない。** テンプレと同じ比較関数に 3 件（遅い順に c, a, b）を
渡すと、出てくる順は **`c < a < b` — 入力順のまま、いちばん遅い申込みが先頭**。
`String(...)` が全行同じなので `localeCompare` は 0 を返し、安定ソートが入力順
（`orderBy("__name__")` = ドキュメント ID 順）をそのまま残す。3 章の推論は当たっていた。

**(2) ページには `Timestamp` が届かない — クラスごと消えている。** structured clone を
通った値の `constructor` は `Object`。つまり `toMillis()` も `toDate()` も無い。
**「ページ側が正しく扱えばいい」という答えは存在しない**（正しく扱うための API が
ページに無い）。正規化が唯一の解であることが、ここで確定する。

**(3) ミリ秒で切ると同着が潰れる。** 同一ミリ秒の 2 件は `…605Z` で**同じ文字列**になり、
`localeCompare` はまた 0 を返す。小数 9 桁の固定幅なら `…605000000Z` / `…605987654Z` で
区別され、辞書順も時刻順のまま。

**(4) `parseIsoDateTime` の消費者は 3 つ、すべて core の中。**
記録の lint（`recordZ.ts`）、カレンダーの配置（`calendarGrid.ts` の `dateOf` / `timeOf`）、
Google への push（`google/pushDateTime.ts`）。`googleCalendar` は `dataPath` を要求するので、
**共有コレクションの値が Google の経路に来ることはない** — 実質 2 つ。

**(5) core は既に「絶対時刻」の語彙を持っている。** `google/datetime.ts` の
`isIsoDateTimeWithOffset` が RFC3339（オフセット必須）を厳格に検査し、**小数秒は
先に正規化して落としている**。新しい概念を持ち込む必要はない。

**(6) 表のソートは `…Z` を読める。ただしミリ秒までしか読めない。**
`dateSortValue` は `Date.parse`（`sortItems.ts:72`）なので `…Z` はそのままエポックになるが、
**同一ミリ秒の 2 件は同点**になり、そこから先は元の順が残る — (3) と同じ落とし穴が
表の側にもある。表は順位の権威ではない（権威はページ）ので今は許容だが、
**「無変更で通る」と書けるのはミリ秒までだと言い切った場合だけ**。表にも同着の順が要るなら、
ソートキーを固定幅の文字列か `seconds`/`nanoseconds` にする。

## 4. 決めること

### D1: 正規形をどこで作るか

| 案 | どこ | プレビュー == 本番 | 既存のビュー | 動かすリポジトリ |
| --- | --- | --- | --- | --- |
| A: 読みの境界 | core の firestore アダプタ | ○（両ホストが同じ物を読む…が、mulmoserver は core を通っていない） | 変わる | core(MulmoClaude) + MT |
| **B: ページに渡す直前** | **sharedapp の純関数を両ホストが呼ぶ** | **○** | 変わる（後述） | sharedapp + mulmoserver + MT |
| C: 検査だけ緩める | core の `strictTypeProblem` | ×（乖離が残る） | 変わらない（＝壊れたまま） | core + MT |
| D: 新しい型 `timestamp` | core の DSL | ×（同上） | 変わらない | core + MT |

**推奨は A と B の両方**（当初は B だけと書いていた。理由は下）。

B — `@receptron/sharedapp/view` は既に「ページが見るもの」の権威で、両ホストが同じコードを
走らせている唯一の場所。ここに正規化を置けば、プレビューと本番が定義上一致する。
C と D は検査を黙らせるだけで、3 章の被害（テンプレの順位）には何もしない。

**A も要る。B はページに渡すものしか触らないから。** 移行ゲート
（`validateCollectionRecords`）に届くのは**生の `Timestamp` オブジェクト**であって文字列では
ないので、lint に「civil か RFC3339 の文字列を受ける」と教えても**この門は開かない** —
どちらの述語もオブジェクトを受けないからで、P1〜P3 を終えても deploy と publish は
止まったままになる。コレクション側は**読みの境界で正規化する**必要がある。

**そして A と B は同じ関数でなければならない。** 別々に書けば、プレビューと本番が
一致しない元の症状が形を変えて戻る。ここで 1 つ未解決の問いが出る:

> その共有された関数はどこに住むのか。core は MulmoClaude のパッケージ、sharedapp は
> receptron。**どちらも相手を依存に持っていない。** 3 章の表を作った境界が
> 2 つのリポジトリに分かれている以上、これは P1 の前に決めること。

そこで:

### D2: 形はいくつにするか — これがこの計画の本題

- **ページ**が欲しいのは「読めて、辞書順が時刻順」。
  `2026-08-15T01:45:54.605000000Z`（**小数 9 桁の固定幅**）が両方を満たす。
  そして**これならテンプレの `localeCompare` は 1 文字も直さずに正しくなる**。

  **ミリ秒で切ってはいけない。** `Timestamp` はナノ秒を持ち、Firestore 自身の順序も
  (`seconds`, `nanoseconds`) で決まる。`Date` / `toISOString()` を通した `…605Z` にすると、
  同じミリ秒に落ちた 2 件は同じ文字列になり、`localeCompare` はまた 0 を返して
  ドキュメント ID 順に戻る — **殺到したときにだけ壊れる**という、この機能で一番あってはいけない
  壊れ方。桁を固定するのは、辞書順が時刻順であるための条件でもある（可変長だと `.61` >
  `.605`）。

  実測した 1 件は `nanoseconds: 605000000` でミリ秒に丸まっていたが、それは**サンプル 1 件の
  観測であって保証ではない**。P0 で、同一ミリ秒に 2 件書いたときに何が入るかを見る。
  ナノ秒まで同着だった場合の決着（ドキュメント ID 順）は**どの読み手も同じ順にする**こと
  自体が要件で、正規形とは別に決める。
- **コレクション DSL**（表・カレンダー・`triggerField`）が受けるのは `YYYY-MM-DDTHH:MM[:SS]`、
  タイムゾーン接尾辞なし。`Z` も `.605` も今は弾かれる。

したがって選択は 2 つ:

1. **形を 1 つにする** — ページも DSL も `…Z`（小数 9 桁）。1 つの値、1 つの形。
2. **消費者ごとに 1 つずつ** — ページは `…Z`（小数 9 桁）、DSL は `YYYY-MM-DDTHH:MM:SS`。
   core は無変更に近い。**同じフィールドがペインの表とページで違う文字列に見える**のが代償で、
   秒未満が落ちるので**同着（先着枠の本番）を DSL 側では区別できない**。

なお `firestore.rules` には先例がある: 文字列と `request.time` は比較できないので、
`window` の境界は publish が**エポックのミリ秒（数値）**に落として渡している。
「ルールが読む形」と「人が読む形」を分けるのは、この設計では既に起きていること。

### D2 の決定（P0 の後、2026-08-15）

**1 を採る。** 2 の「秒未満が落ちる」は、よりによって先着枠が必要とする精度そのもの
（P0 の (3)）。

ただし**やり方は当初案から変える。`parseIsoDateTime` は広げない。**

当初は「civil のパーサを `…Z` も受けるように広げる」と書いていたが、あの厳格さは
カレンダーの配置を守っているもので（絶対時刻を civil の升目に置く、が壊れる）、
広げると守っている当のものが壊れる。P0 の (4)(5)(6) が別のやり方を示している:

- **記録の lint**（`recordZ.ts`）が `datetime` の値として **civil の形か、RFC3339 の絶対時刻か
  のどちらか**を受ける。ただし**これだけでは移行ゲートは開かない** — そこに届くのは
  文字列ではなく生の `Timestamp` なので、D1 の A（読みの境界での正規化）が先に要る。絶対時刻の判定は `isIsoDateTimeWithOffset` が既にあり、
  小数秒も正規化して落としている（小数 9 桁がここを通ることは、それ自体を検査に入れる）。
- **カレンダーの配置**（`calendarGrid.ts`）だけが civil を必要とするので、絶対時刻は
  **置く直前に** civil へ落とす。`parseIsoDateTime` は civil のまま、厳格なまま。
- **表のソート**は無変更で通る（`Date.parse`）。
- **Google の経路**は共有コレクションから到達不能なので、対象外。

これで触るのは「受け入れ」と「置く直前」の 2 か所で、パーサの意味は変わらない。

**P0 の後も残っている問い**（P3 で答える）:

- 絶対時刻を civil の升目に置くとき、**どのタイムゾーン**で落とすのか。ホストのローカルなら、
  同じレコードが人によって違う日に乗る。UTC なら誰にとっても同じで、誰にとっても自分の日ではない。
- `datetime` の**編集フォーム**（`<input type="datetime-local">`）に絶対時刻は入らない。
  `stampField` はルールで凍結されているので編集できてはいけない値だが、
  「編集できない」と「フォームが黙って空になる」は別のこと。

### D3: 読んだ値を書き戻したらどうなるか

正規化は読みにしか効かない。`manageCollection putItems` の `upsert` は**レコード全体を
置き換える**ので、復号した文字列を含む行をそのまま書き戻すと `stampField` が文字列になり、
以後ルールの不変条件に引っかかって、本人も編集者も**そのレコードを二度と更新できなくなる**。

**「書き込み経路で落とす」は解にならない。** ルールの `stampHeld` は
`request.resource.data.diff(resource.data).affectedKeys()` を見るので、**キーを消すことも
「動いた」**。値を書き換えた upsert と同じように拒否される。

残る選択肢は 2 つで、どちらも実装より先に決めること:

- **全置換をやめる** — この経路を merge / フィールドマスクにして、`stampField` を書かない。
- **書く直前に生の値を戻す** — 復号前の `Timestamp` を持っている側が、書き込みの直前に
  差し替える。

どちらにせよ「その名前を知っているのは誰か」が付いて回る（`app.json` を読むのはホスト、
`putItems` はコレクション側）。**ここが一番ややこしい。**

### D4: ルールは触らない

`request.time` との比較も、`stampField` の不変条件も変えない。1000 式の予算にも影響しない。
**この計画で `firestore.rules` の deploy は発生しない** — 3 リポジトリを跨ぐが、
手動 deploy の段は無い。

## 5. 順番

| | やること | リポジトリ |
| --- | --- | --- |
| ~~P0~~ | **済み（3b）** — 4 経路の実測、テンプレのソートが入力順のままであること、`parseIsoDateTime` の消費者 3 つ、D2 の決定 | MT |
| **P0-live** | **未了。実アプリで端から端まで** — gym テンプレのアプリに順番を空けて 2 件申し込み、`/p/{slug}` の順位が申込順と一致するかを見る。同一ミリ秒に 2 件書いて `nanoseconds` に何が入るかも。**3b はメカニズムを測ったのであって、本番の経路を通していない。** 別行にしてあるのは、P0 を消化済みにすると未検証のままここが飛ばされるから | MT |
| P0b | **今の 4 つの形をテストで固定する** — 本物の `Timestamp` を 1 個作り、本番のビューチャンネル・HTTP の応答・headless の `page.evaluate` 引数・`validateCollectionRecords` の入力の 4 か所で、何が届くかを表明する。3 章の表は**コードを読んで書いたもの**で、変更後に何が変わったかを言えるのは、変更前を固定してある場合だけ | MT / mulmoserver |
| P1 | 正規化の純関数と、その形の定義。テスト付き | sharedapp |
| P2 | ページに渡す前に両ホストが呼ぶ。プレビュー・headless・本番の 3 経路 | mulmoserver / MT |
| P3 | DSL 側の受け入れ（D2 で決めた形）と、移行ゲートが通ること | core（MulmoClaude） |
| P4 | 書き戻しの穴（D3） | 決めた場所 |
| P5 | テンプレと `mulmoterminal-shared-app` スキルの記述を、決まった形に合わせる。既に公開されているアプリの扱いも書く | MT |

P0 の答えが D2 を決め、D2 が P1 の形を決める。**P1 より前に手を動かさないこと** —
形を 1 つ間違えると、既に書かれたビューを全部巻き込む。

## 6. 採らなかったもの

- **ルールを緩めて文字列を書かせる**。`request.time` の比較が消え、昨日の日付を書いて
  列の先頭に並べられる。先着枠は「順位が定員の代わり」なので、これは機能の削除。
- **`confirm: true` で運用する**。レコードは恒久的に不適合のまま、deploy と publish が
  毎回止まり、その警告を読む人がいなくなる（今回のテストで既に 1 回そうなった）。
- **MulmoTerminal だけで検査を緩める**。ペインは静かになるが、ページが受け取る形は
  3 通りのままで、テンプレの順位も直らない。**この症状の本体は検査ではない。**

## 7. 検査（1 行で）

**1 つのサーバ時刻フィールドについて、ペインの表・ペインのプレビュー・headless preview・
本番のページ・移行ゲートの 5 か所が、同じ 1 つの値を言うか。**

「同じ」の意味は D2 の選択で変わる:

- **1 を採った場合** — 5 か所とも**文字列として等しい**。それ以外は不一致。
- **2 を採った場合** — ページ側の 3 か所（プレビュー・headless・本番）は文字列として等しく、
  DSL 側の 2 か所は**それを秒に丸めたもの**と等しい。丸めの規則と、丸めたほうでは同着が
  区別できないことを、その場で書いておくこと。

そして先着枠については、**申込順に並べたときの順位が、申し込んだ順と一致するか** —
同一ミリ秒に落ちた 2 件を含めて。
