# feat: 共有コレクション（shareable collection）

**Status**: 実装中（ステップ 2 完了 — Firestore ルール + emulator テスト）

> ## 検証の状態 — 読む前に
>
> **ルールは実行された。** 2026-08-10、`../mulmoserver` の branch
> `feat/shareable-collections-rules`（**mulmoserver #155**）で Firestore emulator の
> ユニットテストが通っている（`yarn test:rules`、CI に独立ジョブ）。
> **本数はこの文書に書かない** — PR に追記されるたびにここが古くなり、同じ文書の別の場所と
> 食い違う（実際に一度そうなった）。**数は #155 の `rules_test` ジョブが持つ。**
> 実装順ステップ 2 は**完了**。
>
> **最初の実行で分かったのは「穴がある」ではなく「1 つも実行できない」だった。**
> 4 巡の静的レビュー（codex 3 巡・Gemini 1 巡）は 14 件を直したが、その全期間を通じて
> **このルールは Firestore 上で動かなかった**:
>
> - **1 リクエストの評価上限は 1000 式で、ルール関数は呼び出し箇所ごとにインライン展開される。**
>   下に書かれた形（任意キーごとに補助関数を置き、各々が `app(aid)` を引き直す）だと
>   `has()` → `submitOpen()` → `hasPub()` → `app()` が 1 つの述語の中で十数回展開され、
>   **非自明な経路がすべて上限に達する。** 症状は権限漏れではなく、自分の行を 1 件読むだけで
>   `Unable to evaluate the expression…`。→ app ドキュメントは**ルールごとに 1 回**取得し、
>   そこから導いた 2 つのマップとともに引数で下へ渡す形に組み替えた
> - **`match /session` は何にもマッチしない。** ドキュメントのパスは偶数セグメントなので
>   `apps/{aid}/session` はコレクション。実際は `apps/{aid}/session/current`
> - 任意キーは `col()` / `sub()` が**空マップに正規化**する。10 件を生んだ無ガード参照を、
>   規律の再掲ではなく**機会の除去**で塞いだ
>
> **したがって、以下の本文に書かれた Firestore ルールのコードは、動かないことが判明した
> 初稿である。** 実際に動くルールは `../mulmoserver/firestore.rules` にあり、そちらが正。
> 本文のコードは、なぜその形になったかの記録として残す。
>
> 実行して初めて出た**設計上の発見**（本文にも反映）:
>
> - **`audience: "participant"` は公開投稿の分岐しか縛らない。** owner / editor は
>   writer 経路で素通りするので、票や回答の水増しを防ぐのは `audience` ではなく
>   **`submitOnly`**。投稿を受けるためだけに存在するコレクションは `submitOnly` を宣言する
>   （リンターの不変条件にする）
> - `assertFails` は**評価エラーでも通る**。だから全ルールに対になる `assertSucceeds` が要る
>   — 無いと「全員に対して壊れている」が「安全」と読める
>
**日付**: 2026-08-10
**関連**: mulmoclaude #2196 / #2197 / PR #2209（ドラフト、Firestore store）、`../mulmoserver`（Firestore ルール）

---

## 何を作るのか

**リポジトリにコミットされた宣言から、ログイン不要で誰でも使える Web アプリを、コードを書かずに公開できるようにする。**

想定シナリオ（設計の全判断はここから導かれる）。**2 つあるのは、突く軸が重ならないから**:

**シナリオ 1 — 美容室の予約サイト**（軸: リソース × 時間 × 承認 × 副作用）

> 美容室のオーナーと美容師が数人。美容師の勤務時間はオーナーが入力する。それが予約表として
> Web に公開され、**誰でも**予約を申し込める。サービスの種類によって所要時間が異なる。
> オーナーまたは美容師が承認すると、申込者に承認メールが届く。

**シナリオ 2 — Web アンケート**（軸: 一人一回 × 書き切り × 期限 × 集計）

> 質問をいくつか用意し、**ログインした上で**答えてもらう。同じ人は 1 回しか答えられない。
> 締切がある。結果は集計して見せたい（ただし個々の回答は本人以外に見せない）。

**シナリオ 3 — オンライン授業の演習**（軸: ライブ × 段階的公開 × 非対称な可視性）

> 先生が生徒に三択問題を**1 問ずつ**提示する。生徒は Web から回答し、答えが揃ったところで
> 先生が正解を教えながら**正答率を見せる**。全問終わると、**先生には全生徒の成績が見え、
> 生徒には自分の成績＋全体統計だけが見える。**

**シナリオ 4 — 議会の投票**（軸: 記録の完全性 × 公開性 × ライブ集計）

> 参加者がトピックごとに賛成・反対を投じ、**結果がリアルタイムでグラフ表示される**。
> 議長がトピックを切り替えると、議員のページも自動的にそのトピックへ進む。
> **戻って投票先を変えることはできない。**

4 つは要求がほとんど重ならない。**4 つとも宣言だけで書ける範囲が、この製品の宣言的表面の下限**になる。

軸の対比:

| | 軸 | 時間 | 他人の回答 | 一番大事なもの |
|---|---|---|---|---|
| 1. 美容室 | リソース × 承認 × 副作用 | 非同期 | 見えない | 到達性（誰でも申し込める） |
| 2. アンケート | 一人一回 × 書き切り × 期限 | 非同期 | 見えない | プライバシー |
| 3. 授業 | ライブ × 段階的公開 × 非対称 | **今** | 見えない | **秘匿**（正解が漏れない） |
| 4. 議会 | 記録の完全性 × 公開性 | **今** | **見える** | **改竄されないこと** |

**シナリオ 3 と 4 は正反対**である点が重要。3 は「隠す」ことが要件、4 は隠すことがむしろ間違い。
同じ機構で方針が逆になるので、**方針は宣言で持たせるしかない。**

> **これらはサンプルであって、システムの仕様ではない。** システムは汎用に作る。
> 4 つは「宣言言語がどこまで表現できなければならないか」を決めるための負荷試験であり、
> 同時に**テンプレートとして同梱**して LLM の参照先にする（「テンプレートとスキーマリンター」参照）。

「誰でも」の強さは**アプリごとの宣言**とする（下の「申込みの認証段階」）。サロンは非ログインで
始めたいかもしれないが、社内の会議室予約なら迷わずログイン必須にすべきで、同じ機構の上で
答えが逆になる。**ルールは凍結インフラなので 3 段階とも最初に入れる。**

このとき:

- 客は一度も AI に会わない。サインインもしない。ただの予約サイトを使う
- オーナーの Mac は**稼働している必要がない**
- アプリの定義は git にあり、diff がレビューでき、履歴と巻き戻しが効く

## なぜこの形なのか（テーゼ）

既存の AI アプリビルダーの成果物は、プラットフォーム内の不透明な状態か、フルのコードベース。
**React のコードベースの diff を人間は承認しない。** `schema.json` の diff は 30 秒で読める。

> **宣言的で狭いことは制約ではなく、エージェントに書かせても統治できる唯一のスケールである。**

そして統治の道具を新規発明しない — git、PR、diff、履歴、rollback、deploy をそのまま借りる。
AI 専用の安全機構は 1 つも要らない。

主張は「AI がアプリを作る」ではなく **「AI が作ったアプリを、既存のエンジニアリング文化が
そのまま統治する」**。

もう 1 つの形: **スキルとアプリが同一の成果物である。** 同じ 1 つのドキュメントが、
エージェントには「このデータの扱い方」を教え、人間には UI を描く。片方は LLM を含むランタイム、
もう片方は含まないランタイム。定義は 1 つ。

---

## 前提として確認済みの事実

調査で確認した、設計がすでに満たしている前提。

**1. MT のプロジェクトスコープは「リポジトリにコミットされた定義」として設計済み**
（`server/backends/collections.ts:104-158`）

> `~` と project は separate worlds。`~/.claude/skills` の下の collection は
> *a machine-global thing no clone of a repository can have* … a stray file would shadow
> **the committed skill**, and it is a second copy of the definition in
> **a repo that is supposed to be self-contained**

`projectSkillsDir` = `<root>/.claude/skills`、`userSkillsDir` と `skillsStagingDir` は
プロジェクトルートでは `null`。**git 管理は後付けの要件ではなく、既に満たされている前提。**

**2. MT は explicit-root モードのマルチルートホスト**（同 `workspaceRoot: null`、
`server/infra/project-root.ts`）。1 プロジェクト = 1 ルート。MulmoClaude は単一ワークスペース。

**3. コレクションの同一性は現在 `(root, slug)`**
（`@mulmoclaude/core/collection/server/host.d.ts` の INVARIANT）

> a slug is unique within a root and nowhere else. A collection's identity is `(root, slug)`.
> Anything keyed by slug ALONE — a cache, a pubsub channel, a view token, a notification id,
> a rendered card — is a cross-root collision waiting to happen.

**共有コレクションには root がない**（相手のマシンにも Web にも存在しない）。ここが変更の核心。

**4. `CollectionStore` に `watch` が既にあり、`StoreChange` は `item` / `collection` の粒度を持つ**
→ `onSnapshot` の `docChanges()` にそのまま対応する。

**5. Firestore ルールは `../mulmoserver` にあり、MC/MT からは変更できない**
（cross-repo の PR + デプロイ）。**実質的に凍結されたインフラとして設計する必要がある。**

---

## 設計判断

### D1. 共有の単位は「コレクション」ではなく「アプリ（= リポジトリ）」

美容室シナリオは 4 コレクション（stylists / services / shifts / bookings）が
**1 つのメンバー表と 1 つの公開設定を共有**する。招待を 4 回やらせるのは論外。

```text
apps/{aid}                               メンバー、公開設定、publish 情報
apps/{aid}/collections/{cid}             publish されたスキーマ + ビュー
apps/{aid}/collections/{cid}/items/{id}  レコード
```

**リポジトリ = アプリ = 共有の単位。** `aid` はリポジトリ内にコミットされるので、
clone した全員が同じアプリを指す（招待は「見つけるため」ではなく「認可のため」だけになる）。

**1 フォルダ 1 アプリで通す。名簿を分けたければリポジトリを分ける。** monorepo の中で
名簿だけ分ける形（サブディレクトリごとに `app.json`）は取らない。名簿がフォルダ境界と
一致していれば「このフォルダを見せる = この人たちに見える」で済むが、入れ子を許した
瞬間、あるコレクションが誰に見えるかはディレクトリを遡らないと分からなくなる。
**共有範囲は、辿らずに分かる場所に置く。**

### D2. 同一性は `(root, slug)` から `(aid, cid)` へ

D1 の帰結。engine の INVARIANT が列挙したもの — キャッシュ、pubsub チャンネル、ビュートークン、
通知 id、描画されたカード — が**すべて対象**。ストア実装の中に閉じない変更であり、
**最初に通すのが正しく、後から通すのが最も高い。**

**2 つの同一性は共存する**（ローカルコレクションは一切変えない、が前提）。したがって engine 側は
片方に寄せるのではなく、**判別可能なユニオン**にする:

```ts
export type CollectionKey =
  | { kind: "local";  root: string; slug: string }
  | { kind: "shared"; aid: string;  cid: string };
```

INVARIANT が列挙したものは**この型で鍵を持つ**。実装順 1 の中身はこの抽象化。

### D2b. `aid` は UUID、URL の名前は別に持つ

`aid` と `cid` は**名前空間の性質が違う**ので、扱いも違う。

- **`apps/{aid}` は全ユーザー共通の棚**で、ルールの `allow create` が要求するのは
  「自分をオーナーと名乗ること」だけ。人間可読な aid は**早い者勝ち**で先回りして
  押さえられ、空いているかも調べられず（`apps/{aid}` は読み取りが絞られている）、
  削除で窓が開き直す
- **`cid` は aid の下に閉じている**うえ、フォルダ内のディレクトリ名なので
  **ファイルシステムが一意性を保証**する。上の 4 つがどれも無い

→ **UUID にするのは `aid` だけ。`cid` は slug のまま**（`schema.json` に `cid` は書かない）。
**生成はコード**（LLM に発明させない）。`app.json` を書くときに生成する — publish まで
遅らせると `putSchema` が共有コレクションを拒否する。

**人が配る URL は aid ではない。** 同一性（aid）と名前（URL）を分け、**取り合いの対象を
捨てても痛くない方に移す**: `app.json` に希望の slug を書き、deploy が予約、publish が
公開する（D10）。衝突していたら後ろに番号を付ける（`sakura-hair` → `sakura-hair-2`）。
一度確保したら再生成しない — URL は人が配るもの。

```text
appSlugs/sakura-hair  →  { aid: "3f2b8c1a-…", published: true }
```

### D3. スキーマとビューは git、レコードは Firestore

```text
git       → schema.json, views/*.html, skill テキスト   （コード。レビュー・履歴・巻き戻し）
Firestore → items/{id}                                  （データ）
```

PR #2209 の当初案（レコードだけ Firestore、スキーマはディスク）でも、検討途中の案
（スキーマも Firestore を真実にする）でもない。**コードとデータを分ける普通のやり方**に落とす。
ビューは HTML なので、そもそも git に置かれるべきものだった。

### D4. Firestore 上のスキーマは「真実」ではなく **deploy された成果物**

Web サイトは git を読めないので、Firestore への反映が要る。ただし**デプロイとして扱う**:

```text
git (source of truth)
  ──deploy───> apps/{aid}/staging/{cid}       .publishedSchema + そのコレクションの
                                              ルール設定 + deployedAt/By/Commit
  ──publish──> apps/{aid}/collections/{cid}   昇格。publishedAt/By/Commit
               apps/{aid}                     + previousPublished（rollback 用）
```

**成果物は 2 段**（D10 の staging）。deploy が `staging/{cid}` に書き、publish が
`collections/{cid}` へ昇格させる。公開ページが読むのは後者だけなので、**deploy は公開中の
アプリのビューを差し替えない**。`/staging/{aid}` は `staging/{cid}` を読むので、publish 前でも
描画できる。記名と前版の退避（`publishedCommit` / `publishedBy` / `publishedAt` /
`previousPublished`）は**昇格させる側**が書く — 「いま公開されているのはどの版か」は
publish の問い。

> **provenance のキーは 2 組ある。** staging の文書と、deploy が書くアプリ文書は
> `deployedAt` / `deployedBy` / `deployedCommit`。公開された版を指す
> `publishedAt` / `publishedBy` / `publishedCommit` と `previousPublished` は
> **publish だけが書く**。同じキーを両方が書くと、草稿を deploy しただけで
> 「いま公開されている版」と rollback 先の記録が動いてしまう。
> スキーマ本体のフィールド名が `publishedSchema` のままなのは出荷済みだからで、
> 改名は移行であって編集ではない。

見た目が古いときの原因は 2 段階で切り分ける: 名簿の人の画面（`/staging/{aid}`）が古ければ
**deploy していない**、公開ページ（`/{slug}`）だけが古ければ **publish していない**。

### D5. MulmoClaude はサポートしない

> **未実装で、現状は逆になっている。** 下のゲートは書かれておらず、しかも
> `setFirestoreAccessor` を呼んでいる**唯一のホストが MulmoClaude**。MulmoTerminal は
> 呼んでいないので共有コレクションを一切扱えない。**本来のホストは MulmoTerminal
> だけ**であり、この逆転を解くのが実装順の課題（下記）。

MC は単一ワークスペース（`~/mulmoclaude`）、MT のプロジェクトルートは separate world。

**理由は実装の都合ではなく、名簿の粒度。** ワークスペースは雑多な置き場（`47news`
`blood-tests` `clients` …）で、そこに `app.json` を 1 つ置くと**全部が同じアプリ =
同じ名簿**になる。「顧客リストの共有相手が血液検査の結果も見える」形になり、D1 の
「共有範囲はフォルダ境界と一致する」が成り立たない。

**黙って成立させない。** ただし core が `isManagedWorkspace`（MT の関数）を呼ぶ形にはしない —
core が特定のホストを知ることになり、MC を触る理由が増える。**ホストが能力を宣言する**:

```ts
// core: ホストが宣言する。setFirestoreAccessor の隣に置く
setSharedCollectionsSupport(true);   // 既定は false

// core: acceptStorageSchema
if (storage.type === "firestore" && !hostSupportsSharedCollections())
  return { ok: false, reason: "this host does not support shared collections" };
```

MC は宣言しない（既定 false）。MT だけが宣言する。**core はどちらのホストの名前も知らない。**

> **`configureCollectionHost` のフィールドにしない。** あれは一度きりのバインドで、
> 本番とテストが同じものを共有する。フィールドにすると、engine の shared store /
> watcher を叩くテストが**自分で能力を立てられず**に落ちる（mulmoclaude #2870 で実際に
> 27 件落ちた）。accessor が `configureCollectionHost` の外にあるのと同じ理由。
>
> **accessor から導出もしない。** 「いまセッションがあるか」と「そもそも共有コレクションを
> 扱うか」は別の問いで、サインインしていないだけでスキーマが「無効」になってはいけない。

### 共有コレクションは MT だけの機能 — MC を触る回数を 1 回にする

engine は `@mulmoclaude/core` にあり、MC と MT が共有している。だが共有コレクションは
**MT だけの機能**なので、素直に書くと「MT の機能を足すたびに MC のリポジトリを変更して
npm に publish して MT で bump する」ことになる。これは設計ではなく事故。

**分け方: core は純粋な部品、MT は順序と操作。**

- **core に残すもの**（すでに export 済み）— `parseAuthoredApp`、`publishProblems` /
  `bindsSubmitterIdentity`、`projectApp`、`validateCollectionRecords`、`discoverCollections`、
  `firestoreHandle`。**どれも「何が正しいか」を判定する純粋な関数**で、MC にあっても害がない
- **MT が持つもの** — `deploy` / `publish` / `unpublish` という**操作**、その**書き込み順**
  （fail closed）、`aid` の生成、`app.json` への書き戻し。今回決めたのはすべてここ

**`manageCollection` に action を足さない。** あのツールは定義もディスパッチも core にあり、
足せば core の変更になる。共有アプリの操作は **MT 独自のホストツール `manageSharedApp`** に置く。
MT だけの機能を MT だけのツールに置くのだから、境界としても自然。

**MC を触るのは 2 本で打ち止め**（実装順 7a）。当初は 1 本の見込みだったが、
#2870 のマージ後に、MT が deploy / publish を自前で回すのに必要な投影がまだ無いことと、
旧 `publishApp` が MT では実際に動いてしまうことが分かった:

- **mulmoclaude #2870（マージ済み）** — 能力の宣言と受け入れゲート、MC の Firestore
  バインド解除
- **mulmoclaude #2871（レビュー中）** — `projectDeploy` / `projectPublish` /
  `promoteSchema`、`staging` と `appSlugs` の置き場所、そして
  **`manageCollection.publishApp` の削除**（必須。残せば迂回経路が残る）

**7b 以降は、この 2 本のマージと npm 公開を待つ。** そのあとは MT 側の作業が
**core の変更なしで進む** — ホストが依存する export は `test_sharedHostSurface.ts` で
固定してあるので、うっかり落ちれば core 側で先に落ちる。

**`manageSharedApp` が引き取る操作は `deploy` / `publish` / `unpublish` の 3 つ。**
書き込み経路を 2 本にしないために、移行はこう定める:

- core の `manageCollection.publishApp` を**削除する**（mulmoclaude #2871、**レビュー中**。
  マージされるまで旧経路は生きている）。
  「残すが呼ばない」では済まない — MT は能力を宣言し accessor も繋ぐので、あの action は
  **MT で普通に動いてしまう**。しかも MT は `manageCollection` をホストツールとして
  登録し、`/api/plugin/manageCollection` が core のハンドラへ直接ディスパッチするので、
  エージェントは呼べる。つまり **staging を飛ばして `public` を先に書く 2 本目の
  書き込み経路**が残り、fail closed の順序が意味を失う
- したがって**書き込み経路は 1 本**（`manageSharedApp`）。core にはもう
  whole-app publish は無く、それを固定するテストも置いた（`test_sharedHostSurface.ts`）

### D5b. 1 フォルダに共有と非共有を混ぜない

`app.json` があるフォルダのコレクションは、**すべて firestore ストレージであること**。

衝突対策ではない — **フォルダの性格を 1 つに定める**ため。混在を許すと、そのフォルダの
コレクションが共有されているかどうかは `schema.json` を 1 つずつ開くまで分からず、
D1 の「共有範囲はフォルダ境界と一致する」がここでも崩れる。

**代償**: そのリポジトリに「共有しないメモ」や下書きコレクションを置けない。下書きは
別のフォルダに置く。**受け入れる** — 判断を 1 回で済ませられることの方が大きい。

### D6. worktree ごとに別のデータを指せるようにする

MT の看板機能は git worktree。**同じリポジトリの worktree 2 つ = コミットされた aid が同じ =
同じ本番レコード**。feature ブランチでスキーマを変えると、チームが今使っているデータに対して
破壊的変更が走る。worktree は「安全に試すため」の機能なので期待と真逆になる。

**MT には既に答えの形がある — `worktreeEnv`**（`common/worktreeEnv.ts`。declared variable ごとに
worktree 固有の値を持つ。dev-server のポート、**データベース名**）。コレクションの aid は
まさに "a database name"。

**新しい `kind` が要る**（当初は不要と書いていたが誤り。下記）: `WorktreeEnvVar` は
`{ kind: "port"; base } | { kind: "slug"; prefix? }`（`common/worktreeEnv.ts:51`）で、
`slug` が worktree 由来の一意な文字列を prefix 付きで作るが、**aid には使えない**。

```json
// .mulmoterminal.json
{ "worktreeEnv": { "MT_APP_SALON": { "kind": "uuid" } } }

// app.json
{ "aid": "3f2b8c1a-…", "aidEnv": "MT_APP_SALON" }
```

> **worktree の aid も UUID でなければならない**（D2b）。`kind: "slug"` は worktree 名から
> **決定的に**導くので、人間可読で推測でき、`apps/{aid}` が早い者勝ちの棚である以上
> 先回りして押さえられる — D2b が aid を UUID にした理由そのものに当たる。
> **`kind: "uuid"`（worktree ごとに一度生成して記録する）が要る**。既存の 2 つの kind では
> 足りない、というのがここでの結論。コミットされる `aid` は本番のもので、`aidEnv` は
> **その worktree でだけ**それを上書きする（D1 の「clone は同じ aid を指す」は保たれる）。

main の worktree は本番 aid、feature の worktree は自動で別の scratch aid。

**worktree の `aid` は Firestore にまだ存在しない、から始まる。** 明示的な手当てが要る:
新しい `aid` の `/apps/{aid}` ドキュメントは当然無いので、**worktree で最初に publish した
とき（または worktree のアプリを最初に開いたとき）に、ホストが主リポジトリの `app.json` から
`members` を読み、新しい `aid` でシードする。** **`public` ブロックは絶対にシードしない** —
コピーした瞬間、その scratch アプリが公開状態で始まる（D10: `public` を載せるのは publish だけ）。
レコードは引き継がない
（引き継いだら「本番を壊さない」が嘘になる）。シードは所有者本人が実行するので
`allow create` の条件をそのまま満たす。

裏を返すと、これは目玉でもある: **エージェントが、動いているアプリの定義を、本番データを
壊さずに書き換えて試せる。** git の分岐がそのままデータの分岐になる。

### D7. ホストはビルド経路にいて、実行経路にはいない（不変条件）

| | ホスト |
|---|---|
| スキーマ/ビューをエージェントが書く | 要る |
| publish（git → Firestore） | 要る（デプロイなので当然） |
| 公開ページの表示 / 予約申込み / スマホからの承認 / 承認メール / 空き枠計算 | **不要** |

**検証方法**: publish する → ホストを落とす → サイトを一通り操作する。落ちたら漏れがある。

副産物として: オーナーの Mac が壊れてもサイトは動き続ける（定義は git、データは Firestore、
復旧は clone + サインイン）。**MulmoTerminal が無くなっても公開されたアプリは動き続ける** —
ロックインが構造的に薄い。

### D8. メンバーシップは email。Cloud Functions を使わない

uid で招待はできない（誰も自分の uid を知らない）。Firestore ルールは
`request.auth.token.email` / `email_verified` を読めるので、**招待 = members に 1 行足すだけ**で
完結する。サーバーサイドのコードはゼロ。

弱さ（メールは変わるし再利用されうる）は受け入れる。厳密にやるなら「初回アクセス時に uid を
claim する」パターンが要り、owner 限定の update に穴を開けることになる。**最初は email のみ。**

### D9. repo の権限と Firestore の members を同期しない

執行系が 2 つあり、互いを参照できない（ルールから「GitHub の write を持つか」は問えない）。
**同期させるのではなく、どちらが何の権威かを決める:**

> **repo は定義を統治する。Firestore はデータを統治する。片方がもう片方を含意しない。**

片側だけを持つ人がどちらも正当:

- **repo だけ**（メンバーではない） — スキーマを保守するが、顧客データは見るべきでないエンジニア
- **メンバーだけ**（repo アクセスなし） — **多数派**。webview から使う非エンジニア。
  この人たちに GitHub アカウントを要求してはいけない

→ **members を repo の collaborator から自動導出しない。**


### D10. Web の入口は 2 つ。招待の前に、名簿の人が本物で試せる

**普通のアプリは、招待や公開の前にテストする。** この設計にはその段階が無かった。
publish が「Firestore に出す」と「本番にする」を兼ねていたため、動作確認の手段が
「先に公開する」しかなかった。

**分けるのはデータではなく、誰に見えるか。** aid は 1 つ、レコードのツリーも 1 つ。
検証用に別の aid を立てる案は**採らない** — テストで入れたデータが本番に持ち越せず、
「検証用のアプリでは動いたのに本番にそのデータが無い」を作る。分けるべきなのは**入口**だけ:

```text
https://<host>/{slug}      公開の顔。未サインインでも読める。slug を確保して初めて生きる
https://<host>/staging/{aid}   名簿の人の入口。aid を直接指す。slug を経由しない
```

**認可はすでにルールが持っている** — `public.enabled` が false なら名簿に載っていない人は
何も読めず、載っていれば自分のロールどおりに使える。足りなかったのは権限ではなく、
`appSlugs/{slug}` を引かずにアプリへ入る経路だけ。

### 操作を 2 つに分ける — `deploy` と `publish`

入口を分けただけでは足りない。`apps/{aid}/config/*` は `allow read: if true` なので、
**テストのために反映しただけでアプリ名が世界に読める**。さらに `appSlugs/{slug}` が
最初から引けると、**人間可読な slug を当てるだけで aid が手に入り**、`/staging/{aid}` の
秘匿が消える。だから操作の側も分ける:

**deploy = staging に出す、publish = staging を公開に昇格させる。**

| | 何をするか | 何を書くか | 危険度 |
|---|---|---|---|
| **deploy** | **staging に出す**。何度でも | **名簿の人しか読めないもの**だけ（`apps/{aid}`、`staging/{cid}`） | 常に安全 |
| **publish** | **staging を公開に昇格させる** | **世界に読めるもの**（`collections/{cid}`、`config/public`、`appSlugs/{slug}` の公開） | 唯一の危険な操作 |

**staging に載るもの（`apps/{aid}/staging/{cid}`、これで全部）:**

| 何 | なぜ staging か |
|---|---|
| `publishedSchema`（スキーマとビュー） | 公開ページが `collections/{cid}` から読むので、deploy で書けば公開中の見た目が変わる |
| そのコレクションの**ルール設定**（`transitions` / `immutable` / `submitOnly` / `peerVisibility` …） | ルールが**公開の書き込みを判定するときに読む** |
| `participantRead` に入るかどうか | 同上 |
| `deployedAt` / `deployedBy` / `deployedCommit` | 記名。公開版を指す `published*` とは別（D4） |

**名簿は staging されない** — `members` に足して deploy した招待は即座に効く
（そうでなければ「招待して一緒にテストする」が成り立たない）。staging を挟むのは
**外に出るもの**だけ。

**分割の急所は `config/public` ではなく、`apps/{aid}` の `public` ブロック。**
ルールが匿名アクセスを判定するのに読むのは**アプリ本体のドキュメント**であって、
公開設定の射影ではない — `publicOn(a)` は `a.public.enabled`、`subOpen(a, cid)` は
`a.public.submit` を見る（`a = get(apps/{aid})`）。`config/public` は**描画のための射影**で、
認可には一切使われない。したがって:

> **deploy は `apps/{aid}` に `public` ブロックを書いてはならない。** 書けば、`config/public`
> が無くても**その瞬間から匿名アクセスが有効**になり、`config/public` を消しても止まらない。
> `public` を app ドキュメントに載せるのは publish、外すのが unpublish。

これを外すと分割は**見た目だけ**になる（`config/public` を伏せても実際の権限は開いている）。
`submit` 側はさらに `enabled` すら見ない（`subOpen` は `public.submit` の有無だけ）ので、
「`enabled: false` で deploy すれば安全」も成り立たない。**UUID の推測しにくさを認可の
境界にしない**、が原則。

- **deploy が書くもの**: `apps/{aid}`（`public` ブロック**抜き**の名簿・内部設定）、
  **`staging/{cid}`**（下記）、`appSlugs/{slug}`（`published: false`）
- **publish が書くもの**: `staging/{cid}` → **`collections/{cid}` への昇格**、
  `apps/{aid}.public`（**認可の本体**）、`config/public`（描画用の射影）、
  `appSlugs/{slug}.published = true`

### staging — スキーマとビューも publish するまで外に出さない

`public` ブロックだけを publish が持つのでは足りない。**公開ページはスキーマを
`apps/{aid}/collections/{cid}` から直接読む**（`schemaRead` に `publicRead` が入っている）。
スキーマを deploy が書く形だと、**公開済みのアプリでは deploy した瞬間にビューが差し替わる** —
「テストのために deploy した」が本番の変更になる。

**同じドキュメントに 2 つの版は置けない。** ルールはフィールド単位で隠せないので、
公開ページが読めるドキュメントに草稿を入れれば草稿も読まれる。**別のドキュメントに分ける**:

```text
apps/{aid}/staging/{cid}       deploy が書く。名簿の人だけが読む。/staging/{aid} が描画に使う
apps/{aid}/collections/{cid}   publish が昇格させる。公開ページが読む（従来どおり）
```

- **レコードのツリーは 1 つのまま。** staging はスキーマとビューの置き場所であって、
  データの分岐ではない。`/staging/{aid}` で試したレコードはそのまま本番のレコード
- **スキーマ変更は後方互換である限りエラーにならない。** 公開中の古いスキーマは、
  新しく増えたフィールドを知らないだけで、既存のレコードを読み続けられる。
  後方互換でない変更は publish のライブレコード事前検証が止める（`confirm` で強行可能）
- **主に変わるのはビュー。** HTML は生成物でスキーマが統治対象（後述）なので、
  ビューの差し替えもこの 1 本の経路に乗る
- `unpublish` は `collections/{cid}` を消さない — 公開でなければ誰も読めないので害が無く、
  再 publish が単なる昇格で済む

**ルールの追加が要る**（`appSlugs` と同じ 2 回目の cross-repo デプロイに相乗りする）:

```
match /staging/{cid} {
  allow read:  if listedIn(app(aid));                 // 名簿の人だけ。公開ページは読めない
  allow write: if role(app(aid), '*') == "owner";     // = deploy
}
```
- **unpublish**: その 3 つを戻す（`public` を外し、`config/public` を消し、`published` を false に）
- **slug の予約は deploy、公開は publish。** `appSlugs/{slug}` に `published: false` を持たせ、
  `allow read: if resource.data.published == true`。**早く押さえられて、かつ公開まで誰も
  辿れない**。`get(apps/{aid})` が要らないので読み取りの式数は増えない（D7 の監視点）
- **門番の置き場所**: 拒否条件は **deploy 側**（スキーマが壊れる話は公開の有無と無関係）。
  publish 側は「公開してよいか」— `public.submit` の不変条件と slug。
  **ライブレコードの検証は両方で行う。** deploy の検証は `confirm` で強行できる
  （移行の途中など、staging で先に進めたいことがある）ので、**強行された草稿がそのまま
  公開に出ないよう、publish は昇格させる版をもう一度検証して fail closed で止まる**。
  publish 側の強行には publish 自身の `confirm` が要る — deploy の `confirm` は
  引き継がれない

**deploy の書き込み順は「アプリ本体が先」。** `appSlugs` の `allow create` は
`get(apps/{aid})` でオーナーを確認するので、**`apps/{aid}` が存在しない初回 deploy では
slug の予約が拒否される**。順序は `apps/{aid}` → `staging/{cid}` → `appSlugs`
（`collections/{cid}` は publish が書くので deploy には出てこない）。
既存の publish 実装が「app ドキュメントが他の 2 つを authorize するので先に書く」と
しているのと同じ理由。

**publish の書き込み順は逆で、`public` を最後に置く（fail closed）。** publish は 3 つの
文書を触るが、**認可を握っているのは `apps/{aid}.public` だけ**。だから

```text
publish:    collections/{cid}（昇格）→ config/public → appSlugs.published = true
            → apps/{aid}.public   ← 最後
unpublish:  apps/{aid}.public を外す ← 最初 → appSlugs.published = false → config/public 削除
            （collections/{cid} は残す）
```

途中で失敗しても、**公開が半端に開くことはない**（射影と URL が先に整い、認可が最後に開く）。
逆順に書くと、`public` だけ通って残りが落ちた瞬間に「匿名アクセスは有効、描画データは
古いか無い」という最悪の状態になる。可能なら **1 つの batch（Firestore の WriteBatch は
原子的）**で書き、batch が使えない経路ではこの順序を守る。**UUID の秘匿を安全弁にしない**
という原則の帰結でもある。同時 publish の版混在は既知の穴（mulmoclaude #2866）。

**`public` が無い状態は「非公開」。** `publicOn(a)` は `"public" in a` を先に見るので、
ブロックが無ければ false で閉じる。deploy が `public` を書かない設計はこれに乗っている
（新しいルールは要らない）。**deploy も worktree のシードも `public` をコピーしない**こと。

**書き方は `set`（置換）で、merge ではない。** merge は**削除できない**ので、
`members.<email>` を消しても権限が残る — しかもルールが `memberEmails` と `members` の
一致を要求するため、merge した削除はそもそも拒否される。`public` を `app.json` から
外して非公開に戻すこともできない。**相手の操作が持つフィールドは、いまの文書から
そのまま持ち越す**ので、置換しても公開を落としたり招待を巻き戻したりしない。

**`collections` と `participantRead` も staging に載る。** これらは**ルールが公開の
書き込みを判定するときに読む**設定なので、deploy で着地させると、スキーマは staging に
留めたまま公開の挙動だけが変わってしまう。代償として `/staging/{aid}` は
「新しいスキーマ × いま公開中のルール設定」で試すことになるが、間違える方向としては
こちらが安全。

**deploy の更新意味論 — 何を上書きし、何を残すか。**

| 文書 | deploy | publish |
|---|---|---|
| `apps/{aid}`（名簿・内部設定） | **書く**（置換。`public` / `collections` / `participantRead` / `published*` は現在値を持ち越す） | 同じ文書を置換し、**その 4 つだけ**を書く |
| `staging/{cid}` | **書く**（スキーマ・ビュー・**そのコレクションのルール設定**の草稿） | 読んで昇格させる |
| `collections/{cid}`（`publishedSchema`） | 触らない | **書く**（staging からの昇格） |
| `appSlugs/{slug}` | 無ければ予約（`published: false`）。**`published` を触らない** | `published` を反転 |
| `config/public` | 触らない | 書く / 消す |

**再 deploy が公開を巻き戻してはならない。** `apps/{aid}` をまるごと置換すると `public` が
消えて**黙って非公開になる**。だが merge で避けてはいけない（merge は削除できない）—
**置換して、`public` / `collections` / `participantRead` / `published*` /
`previousPublished` は現在値をそのまま持ち越す**。`appSlugs.published` には触らない。

> **`publishedSchema` は歴史的なフィールド名**（出荷済みなので改名は移行であって編集では
> ない）で、**staging と公開の両方の文書で同じ名前が使われる**。名前に引きずられて
> 「deploy が公開の成果物を書く」と読まないこと — deploy が書くのは `staging/{cid}`、
> `collections/{cid}` を書くのは publish だけ（D4）。

**publish は繰り返せる。** 公開設定を変えたら publish し直す（`unpublish` してからやり直す
必要はない）。既に `published: true` の slug に対する publish は**冪等**で、`apps/{aid}.public`
と `config/public` を新しい版で置き換え、`previousPublished` に前版を退避する。
`unpublish` は「やめる」ときだけ。同時 publish の版混在は既知の穴（mulmoclaude #2866）。

`/staging/{aid}` は **deploy だけで動く**。つまりテストと招待は publish 抜きで完結する。

段階はこうなる。**`publish` は操作、`public` は `app.json` のブロック名**（紛らわしいが別物）:

| | 何をする | 誰に見えるか |
|---|---|---|
| 1 | `app.json` + スキーマ → **deploy** | オーナーだけ。`/staging/{aid}` で**実データで**動作確認 |
| 2 | `members` を足す → **deploy** | 招待した人も `/staging/{aid}` を使える |
| 3 | `public` を足す → **publish** | `/{slug}` が生き、お客さんが来る |

**`/staging/{aid}` は公開後も消えない。** お客さんが `/{slug}`、スタッフが `/staging/{aid}` で
承認作業をする、という使い分けがそのまま残る。**名簿の人が見るのは常に staging の版**
（`staging/{cid}`）で、お客さんが見るのは昇格済みの版 — 入口の名前と、その入口が読む
ドキュメントの名前が一致している。

これは開発環境ではない。**データは 1 つ**で、staging なのはスキーマとビューだけ。

---

## 権限モデル

3 つではなく、**2 軸（定義 / データ）× 読み書き + publish の 5 つ**。

|  | 読む | 書く |
|---|---|---|
| **定義**（スキーマ・ビュー） | repo read | repo write + PR |
| **定義の反映** | — | **publish**（owner のみ） |
| **データ**（レコード） | members: viewer | members: editor |

`members` は 4 値 + コレクション別（`participant` は「名指しされているが member ではない」層。
シナリオ 3 の生徒、シナリオ 2 の限定配布アンケートの対象者）:

```json
"members": {
  "owner@salon.jp":  { "*": "owner" },
  "stylist-a@x.jp":  { "bookings": "editor", "shifts": "viewer", "services": "viewer" },
  "student-1@school.jp": { "*": "participant" }
}
```

| ロール | できること |
|---|---|
| `owner` | publish、メンバー管理、`session` の駆動、レコードの削除、全件読み取り |
| `editor` | レコードの読み書き（全件） |
| `viewer` | レコードの読み取り（全件） |
| `participant` | submit + 自分の行 + public / `revealed` 済みのみ。**全件は読めない** |

> **`participant` は `members` に載るが `reader()` には含まれない。** ルールで
> 「名簿にいるか（`listed`）」と「全件読めるか（`reader`）」を混同すると、
> 参加者に全データが漏れる（「レビューで塞いだ穴」1 番）。

repo の権限（① ②）は **members に入れない**。GitHub の仕事。混ぜた瞬間に
「Firestore が repo の権限を知っている」という嘘が始まる。

### publish が唯一の危険な操作

PR をマージしても誰の画面も変わらない。publish した瞬間に全員が変わる。しかも 2 つの意味で:

1. **破壊的スキーマ変更** — フィールドの削除/rename で生きているレコードが不整合になる
2. **ビューは HTML** — **publish 権限 ≒ 全メンバーのブラウザで JS を実行する権限**

対策は既存コードで足りる:

- **publish 前にライブデータを検証する** — `validateCollectionRecords` / `recordFieldProblem`
  で「新スキーマで既存レコードが何件壊れるか」を出し、0 件でなければ確認を挟む。
  **publish がそのままマイグレーションのゲートになる**
- **publish は記名される** — 誰が・どのコミットを・いつ。前版を残して rollback 可能に

CI からの publish には owner ロールを持つサービスアカウントが要り principal の種類が増えるので、
**最初は手動 + コミットスタンプ**。

---

## Firestore ルール（静的・汎用）

**ルールは静的なまま。ACL は「ルール」ではなく「データ」にする。** コレクションが何個増えても
ルールファイルは 1 文字も変わらない。

> **以下のコードは動かない初稿である。** 1000 式の評価上限に達して 1 つも実行できず、
> `match /session` は何にもマッチしない（上「検証の状態」）。**実際に動くルールは
> `../mulmoserver/firestore.rules`。** ここは、なぜその形になったかの記録として残す。

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 署名済み（匿名認証を含む）と、検証済みメールを持つ、を分ける。
    // uid ベースの判定に verified() を要求すると匿名認証が自分の行を読めなくなる
    function authed()   { return request.auth != null; }
    function verified() { return authed() && request.auth.token.email_verified == true; }
    function email()    { return request.auth.token.email; }
    function app(aid)   { return get(/databases/$(database)/documents/apps/$(aid)).data; }

    // 名簿に載っているか（participant を含む）。「データを読める」という意味ではない
    function listed(aid) { return verified() && "members" in app(aid)
                                  && email() in app(aid).members; }

    // '*' を持たないメンバー（S1 の美容師のようにコレクション別ロールだけの人）が
    // いるので、フォールバックも `in` でガードする。無いと roleIn 自体が落ちる
    function roleIn(aid, cid) {
      return !listed(aid) ? null
           : cid in app(aid).members[email()] ? app(aid).members[email()][cid]
           : '*' in app(aid).members[email()] ? app(aid).members[email()]['*']
           : null;
    }
    // どれか 1 つでも書き手ロールを持つか（コレクション別ロールだけの人を弾かないため）
    function writerOf(aid, cid) { return roleIn(aid, cid) in ["owner", "editor"]; }
    // 全件を読める役割。participant は決して含まれない
    function reader(aid, cid) { return roleIn(aid, cid) in ["owner", "editor", "viewer"]; }

    // --- 任意キーは必ず `in` でガードしてから読む（規律。理由は本文「同じ形のバグが3巡続いた」）
    function hasPub(aid)          { return "public" in app(aid); }
    function publicOn(aid)        { return hasPub(aid) && "enabled" in app(aid).public
                                           && app(aid).public.enabled == true; }
    function publicRead(aid, cid) { return publicOn(aid) && "read" in app(aid).public
                                           && cid in app(aid).public.read; }
    function partRead(aid, cid)   { return listed(aid) && "participantRead" in app(aid)
                                           && cid in app(aid).participantRead; }
    function hasCol(aid, cid)     { return "collections" in app(aid) && cid in app(aid).collections; }
    function colFlag(aid, cid, k) { return hasCol(aid, cid) && k in app(aid).collections[cid]; }
    function immutableCol(aid, cid) { return colFlag(aid, cid, "immutable")
                                           && app(aid).collections[cid].immutable == true; }
    function rollCall(aid, cid)     { return colFlag(aid, cid, "peerVisibility")
                                           && app(aid).collections[cid].peerVisibility == "public"; }
    function gatedCol(aid, cid)     { return colFlag(aid, cid, "revealGated")
                                           && app(aid).collections[cid].revealGated == true; }
    // 記録の作成を「投稿経路」だけに限る。owner/editor でも直接は作れない。
    // これが無いと、immutable は「書き換えられない」だけで「捏造できない」を意味しない
    function submitOnlyCol(aid, cid) { return colFlag(aid, cid, "submitOnly")
                                           && app(aid).collections[cid].submitOnly == true; }

    match /apps/{aid} {
      function membersConsistent() {
        return request.resource.data.memberEmails.toSet()
            == request.resource.data.members.keys().toSet();
      }

      // 名簿そのものは reader だけ。participant に読ませると同級生のメールが見える。
      // ルールの get() は read ルールの影響を受けないので、これで判定は壊れない
      allow read:   if reader(aid, '*');
      allow create: if verified()
                    && request.resource.data.owner == request.auth.uid
                    && email() in request.resource.data.members
                    && '*' in request.resource.data.members[email()]
                    && request.resource.data.members[email()]['*'] == "owner"
                    && membersConsistent();
      allow update: if roleIn(aid, '*') == "owner"
                    && request.resource.data.owner == resource.data.owner
                    && membersConsistent();
      // 【初稿。実際のルールは違う】 owner に削除を許すと、Firestore は
      // カスケードしないので子が孤児になり、空いた aid を拾った他人が
      // owner になれる（下記「アプリの削除（再帰削除）」）。
      // 実際のルールは `allow delete: if false;` で、削除は再帰削除に属する。
      allow delete: if roleIn(aid, '*') == "owner";

      // participant / 匿名が読む公開設定（名簿を含まない）。owner が publish 時に書く
      match /config/{docId} {
        allow read:  if true;
        allow write: if roleIn(aid, '*') == "owner";
      }

      // 主催者が駆動する状態機械（シナリオ 3 / 4）。
      // writerOf は editor を含むので、それだと editor が phase を revealed にして
      // 正解を開示したり、投票を勝手に開閉したりできる。ロール表どおり owner のみ
      match /session {
        allow read:  if listed(aid) || publicOn(aid);
        allow write: if roleIn(aid, '*') == "owner";
      }

      match /collections/{cid} {
        allow read:  if reader(aid, cid) || publicRead(aid, cid) || partRead(aid, cid);
        allow write: if roleIn(aid, '*') == "owner";     // = publish

        match /items/{itemId} {
          function submitOpen() { return hasPub(aid) && "submit" in app(aid).public
                                         && cid in app(aid).public.submit; }
          function cfg()        { return app(aid).public.submit[cid]; }
          function has(k)       { return submitOpen() && k in cfg(); }
          function session()    { return get(/databases/$(database)/documents/apps/$(aid)/session).data; }

          // 親（gatedFrom）の同 id を見る。exists() を挟まないと未作成時に評価が落ちる
          function gatedParent(aid, cid, itemId) {
            return /databases/$(database)/documents/apps/$(aid)/collections/$(app(aid).collections[cid].gatedFrom)/items/$(itemId);
          }
          function gatedRevealed(aid, cid, itemId) {
            return "gatedFrom" in app(aid).collections[cid]
                && "revealBy" in app(aid).collections[cid]
                && exists(gatedParent(aid, cid, itemId))
                && app(aid).collections[cid].revealBy in get(gatedParent(aid, cid, itemId)).data
                && get(gatedParent(aid, cid, itemId)).data[app(aid).collections[cid].revealBy] == true;
          }

          function authMode() { return has("auth") ? cfg().auth : "none"; }
          function authOk() {
            return authMode() == "none"
                || (authMode() == "anonymous" && authed())
                || (authMode() == "verifiedEmail" && verified()
                    && (!has("emailField")
                        || request.resource.data[cfg().emailField] == email()));
          }

          // ID 戦略は有限の enum。文字列連結で複合 ID を検証する
          function idOk() {
            return !has("idFrom")
                || cfg().idFrom == "auto"
                || (cfg().idFrom == "auth.uid" && authed() && itemId == request.auth.uid)
                || (cfg().idFrom == "auth.uid+field" && authed() && has("idField")
                    && cfg().idField in request.resource.data
                    && request.resource.data[cfg().idField] is string
                    && itemId == request.auth.uid + "_" + request.resource.data[cfg().idField]);
          }
          // ルールは文字列を timestamp に暗黙変換しない。ISO 文字列と request.time を
          // 比較すると型エラーで fail closed になるので、publish が epoch millis
          // （数値）に落としたものを見る（下記「authored と published は別物」）
          function inWindow() {
            return !has("window")
                || (request.time.toMillis() < cfg().window.untilMs
                    && (!("fromMs" in cfg().window)
                        || request.time.toMillis() > cfg().window.fromMs));
          }
          // status フィールドの名前は **コレクション設定が単一の出所**。
          // submit 設定と mail 設定に散らすと、食い違ったときに検査が静かに外れる
          function hasColStatus() { return colFlag(aid, cid, "statusField"); }
          function colStatus()    { return app(aid).collections[cid].statusField; }
          function curStatus()  { return hasColStatus() && colStatus() in resource.data
                                  ? resource.data[colStatus()] : null; }
          function nextStatus() { return hasColStatus()
                                       && colStatus() in request.resource.data
                                  ? request.resource.data[colStatus()] : null; }
          function changed()    { return request.resource.data.diff(resource.data).affectedKeys(); }

          // 宣言された状態遷移は **誰に対しても** 効く。writer は無条件に書ける、では
          // アクションの `require`（pending からのみ承認できる）が助言になり、
          // cancelled の予約をいきなり approved にできてしまう
          function tGraph() { return app(aid).collections[cid].transitions; }
          // null を「素通り」にしてはいけない。status を消せると、消してから
          // 任意の状態に入れて状態機械を丸ごと迂回できる（2 手で pending を経由せず
          // approved に到達する）。したがって:
          //   - status を消す / null にする書き込みは拒否（nextStatus() != null）
          //   - すでに status を持たない既存レコード（取り込み等）は、
          //     **宣言された復帰口 `initial` にだけ**入れる
          // create にも状態機械を効かせる。update だけに掛けていたので、writer は
          // 最初から approved のレコードを作れた（initial → pending を迂回できた）
          function initialOk() {
            return !colFlag(aid, cid, "transitions") || !hasColStatus()
                || (nextStatus() != null && "initial" in tGraph()
                    && tGraph().initial.hasAny([nextStatus()]));
          }
          function transitionOk() {
            return !colFlag(aid, cid, "transitions") || !hasColStatus()
                || (nextStatus() != null
                    && (curStatus() == nextStatus()
                        || (curStatus() != null && curStatus() in tGraph()
                            && tGraph()[curStatus()].hasAny([nextStatus()]))
                        || (curStatus() == null && "initial" in tGraph()
                            && tGraph().initial.hasAny([nextStatus()]))));
          }

          // 匿名認証でも自分の行には届く（uid 判定に verified を要求しない）。
          // **宣言された ID 戦略に束縛する**のが要点。前方一致を無条件に許すと、
          // idFrom: "auto" のコレクション（S1）で攻撃者が `<被害者uid>_x` という id の
          // レコードを作れてしまい、被害者に他人のレコードの自己編集権が生える。
          // 複合 id は正規表現の前方一致ではなく、保存されている値から id を
          // 復元して厳密一致させる（uid に正規表現メタ文字が来ても壊れない）
          function ownRow() {
            return authed() && submitOpen()
                   && ((has("idFrom") && cfg().idFrom == "auth.uid"
                        && itemId == request.auth.uid)
                    || (has("idFrom") && cfg().idFrom == "auth.uid+field"
                        && has("idField") && cfg().idField in resource.data
                        && itemId == request.auth.uid + "_" + resource.data[cfg().idField])
                    || (verified() && has("emailField")
                        && cfg().emailField in resource.data
                        && resource.data[cfg().emailField] == email()));
          }

          allow read: if reader(aid, cid)
                      || publicRead(aid, cid)
                      || partRead(aid, cid)
                      // 記名投票: 名簿にいる全員が全件読める
                      || (rollCall(aid, cid) && listed(aid))
                      // 段階的公開: フラグの真実は「親」の側にある。gated が生成した
                      // 従属ドキュメントは correctChoice / explanation しか持たないので、
                      // ここで resource.data.revealed を見ると永久に false になる。
                      // 親が未作成・削除済みだと get().data が例外になるので exists() が要る
                      || (gatedCol(aid, cid) && listed(aid) && gatedRevealed(aid, cid, itemId))
                      // 自分の行だけ（participant はここまで）
                      || ownRow();

          // 値の検査は宣言があれば **誰の書き込みにも** 効かせる（writer 経由でも）
          function validateOk() {
            return !has("validate")
                || ((!("required" in cfg().validate)
                     || request.resource.data.keys().hasAll(cfg().validate.required))
                    && (!("keyFields" in cfg().validate)
                        || (cfg().validate.keyFields.size() <= 2
                            && (cfg().validate.keyFields.size() < 1
                                || (cfg().validate.keyFields[0].field in request.resource.data
                                    && cfg().validate.keyFields[0].values.hasAny(
                                         [request.resource.data[cfg().validate.keyFields[0].field]])))
                            && (cfg().validate.keyFields.size() < 2
                                || (cfg().validate.keyFields[1].field in request.resource.data
                                    && cfg().validate.keyFields[1].values.hasAny(
                                         [request.resource.data[cfg().validate.keyFields[1].field]]))))));
          }

          allow create: if initialOk() && validateOk()
                        && ((writerOf(aid, cid) && !submitOnlyCol(aid, cid))
                        || (submitOpen()
                            // 匿名（auth: "none"）で開くならマスタースイッチも要る
                            && (authMode() != "none" || publicOn(aid))
                            && has("createFields")
                            && request.resource.data.keys().hasOnly(cfg().createFields)
                            && request.resource.data.size() <= 200
                            && (!has("initialStatus")
                                || (hasColStatus() && colStatus() in request.resource.data
                                    && request.resource.data[colStatus()] == cfg().initialStatus))
                            && authOk()
                            // `!= null` だと viewer / editor まで投稿できてしまう。
                            // 宣言した audience と認可を一致させる
                            && (!has("audience") || cfg().audience != "participant"
                                || roleIn(aid, cid) == "participant")
                            && idOk() && inWindow()
                            && (!has("gateOn")
                                || (session().phase == cfg().gateOn.phase
                                    && session().current
                                         == request.resource.data[cfg().gateOn.match]))));

          // immutable なら誰も（owner でも）更新できない。
          // 本人の更新は「変わったキーが selfUpdate[現在の状態] の範囲」— ドキュメント全体の
          // hasOnly ではない。status のような system field は差分に現れた時点で拒否される。
          // 宣言された状態遷移（キャンセル等）だけは status の変更を許す
          allow update: if !immutableCol(aid, cid)
                        && transitionOk()
                        && (writerOf(aid, cid)
                            || (ownRow() && !(has("finalize") && cfg().finalize == true) && inWindow()
                                // 本人が触ってよいフィールドは **現在の状態ごと** に宣言する。
                                // 平坦なリスト（状態を見ない selfUpdate）だと、承認済みの予約の startAt を
                                // 客が黙って動かせる（枠が移り、承認し直されない）
                                && ((has("selfUpdate") && curStatus() != null
                                     && curStatus() in cfg().selfUpdate
                                     && changed().hasOnly(cfg().selfUpdate[curStatus()]))
                                    // 宣言された本人遷移（キャンセル等）
                                    || (has("selfTransitions") && curStatus() != null
                                        && changed().hasOnly([colStatus()])
                                        && curStatus() in cfg().selfTransitions
                                        && cfg().selfTransitions[curStatus()]
                                             .hasAny([nextStatus()])))));

          allow delete: if !immutableCol(aid, cid) && writerOf(aid, cid);
        }
      }

      // 宣言的な副作用のキュー（Firebase Trigger Email 拡張が読む）。
      // '*' ロールを持たない人（コレクション別 editor の美容師）が承認メールを
      // 出せなくなるので、そのアクションが属する cid の書き手も通す
      match /mail/{mailId} {
        function m()       { return request.resource.data; }
        function mailCfg() { return app(aid).collections[m().cid].mail; }
        function srcItem() {
          return /databases/$(database)/documents/apps/$(aid)/collections/$(m().cid)/items/$(m().itemId);
        }
        // 宛先とテンプレートを縛るだけでは足りない。それだけだと書き手は、
        // どんな状態の予約に対してでも `booking-approved` を何度でも積める。
        // つまり「承認したから送る」というアクションと遷移が助言にとどまる。
        // 2 つで縛る:
        //   - 決定的な mailId → 同じアクションを二度積めない（create は 1 回しか通らない）
        //   - get() が `from` に入り getAfter() が `to` である → **この書き込みが、
        //     宣言された遷移を行った**こと。to だけでは (a) すでに approved の記録に
        //     何も書かずメールだけ積める (b) cancelled から直接 approved にして送れる
        // クライアントは記録の更新とメールの enqueue を 1 つのバッチで書く必要がある
        allow create: if listed(aid)
                      && m().keys().hasAll(["cid", "itemId", "to", "template"])
                      && m().keys().hasOnly(["cid", "itemId", "to", "template", "data"])
                      && hasCol(aid, m().cid) && "mail" in app(aid).collections[m().cid]
                      && writerOf(aid, m().cid)
                      && mailId == m().cid + "_" + m().itemId + "_" + m().template
                      && exists(srcItem())
                      && mailCfg().toField in get(srcItem()).data
                      && get(srcItem()).data[mailCfg().toField] == m().to
                      && m().template in mailCfg().on
                      && "statusField" in app(aid).collections[m().cid]
                      && app(aid).collections[m().cid].statusField in get(srcItem()).data
                      && app(aid).collections[m().cid].statusField in getAfter(srcItem()).data
                      // 遷移「先」だけでなく「元」も宣言どおりであること。
                      // to だけだと cancelled/rejected から直接 approved にして
                      // booking-approved を送れる（アクションの require を迂回する）
                      // 実際に変化したこと。`from` と `to` が素であることは
                      // リンター項目にしたが、**リンターはルールの代わりにならない**
                      // （作者の手元でしか走らない）。ここで明示的に要求する
                      && get(srcItem()).data[app(aid).collections[m().cid].statusField]
                           != getAfter(srcItem()).data[app(aid).collections[m().cid].statusField]
                      && mailCfg().on[m().template].from
                           .hasAny([get(srcItem()).data[app(aid).collections[m().cid].statusField]])
                      && getAfter(srcItem()).data[app(aid).collections[m().cid].statusField]
                           == mailCfg().on[m().template].to
                      && (!("data" in m()) || m().data.keys().hasOnly(mailCfg().dataFields));
        allow read, update, delete: if false;
      }
    }

    match /{document=**} { allow read, write: if false; }
  }
}
```

`delete` を `write` から分けているのは、削除時に `request.resource` が null になり
サイズ判定が壊れるため。

### レビューで塞いだ穴（記録）

初稿のルールには 3 つの実害ある欠陥があった。**同じ間違いが再発しやすいので残す。**

**1. `participant` が全件を読めていた。** `member(aid)` を「名簿にいるか」と定義し、item の read を
`member(aid)` で許していた。`participant` も名簿（`members`）に載るので、**生徒が同級生の回答を、
回答者が他人のアンケートを読めた。** シナリオ 2 と 3 の前提が崩れる。
→ **`listed()`（名簿にいる）と `reader()`（全件読める役割）を分離。** `participant` は
`reader()` に決して含まれない。名簿に載っていることと、データを読めることは別。

**2. 申込者が自分の予約を `approved` にできた。** `status` は create 時に `initialStatus` を
検証するため `fields` に必要だが、更新規則が**同じ `fields` に対する `hasOnly`** だったため、
本人が `status` を書き換えられた。**これは権限昇格。**
→ **`createFields` と `selfUpdate` を分離**し、更新は
`diff(resource.data).affectedKeys().hasOnly(selfUpdate[現在の状態])` で**変わったキー**を見る。
状態遷移は `selfTransitions` で宣言されたものだけ許す。

> この欠陥は**下のリンター表に自分で書いた項目そのもの**（「管理用フィールドが
> 混ざっている → 権限昇格」）。設計者が自分の検査項目を自分のサンプルで破った。
> **リンターが要るという主張の、これ以上ない裏付け。**

**3. 複合 ID が表現できていなかった。** `idFrom` があれば `itemId == request.auth.uid`、という
単一の規則だった。シナリオ 3・4 は `{uid}_{questionId}` を要求するので、**全問・全議題で
1 ドキュメントしか作れない**（＝ 2 問目以降が投稿できない）。
→ **`idFrom` を有限の enum** にし、`"auth.uid+field"` + `idField` を文字列連結で明示的に検証する。

**4. `auth` を boolean にしていたため、S2/S3/S4 の投稿が全部拒否されていた（2 巡目）。**
`requireAuth: true` のとき `data[cfg().emailField] == email()` を必須にしていたが、
アンケート・小テスト・投票は `emailField` を宣言しない。ルールが存在しないキーを参照して落ち、
**create が常に失敗する。** 同じ理由で `ownRow()` も落ちていた。
→ **`auth` を有限 enum（`none` / `anonymous` / `verifiedEmail`）** にし、email の一致強制は
`emailField` を宣言したときだけに切り離した。ついでに段階 B（匿名認証）が
boolean では表現できていなかったことも解消した。

**5. `gated` の公開が永久に効かなかった（2 巡目）。** 読み取り条件を
`resource.data.revealed == true` にしていたが、**生成される従属ドキュメントは
`correctChoice` と `explanation` しか持たない。** 正解を明かしても生徒に届かない。
→ **親（`gatedFrom`）の同じ id を `get()` してフラグを見る。** フラグの真実は親にしかない。

**6. `public.enabled` が何もゲートしていなかった（2 巡目）。** read は
`cid in public.read` だけを見ていたので、`enabled: false` でも匿名で読めた。
S3 は `enabled: false` のまま `questions` / `stats` を `public.read` に置いており、
**授業の問題が誰でも読める状態だった。**
→ `publicOn()` をマスタースイッチにし、名簿にいる人に開くための
**`participantRead` を別に用意**した（participant は `reader()` ではないので、これが無いと
生徒が問題文すら読めない）。

**7. 任意キーを無ガードで読んでいた（3 巡目）。** `partRead()` は
`cid in app(aid).participantRead` を見るが、S1/S2 はそのキーを宣言していない。
同じ形が `app(aid).collections[cid]`（`immutable` / `peerVisibility` / `revealGated`）、
`cfg().audience`、`cfg().selfUpdate`、`cfg().selfTransitions` にもあった。
**存在しないキーを読むとルールが落ち、自分の予約・自分の回答すら読めなくなる（fail closed）。**
→ **任意キーは必ず `in` でガードしてから読む**という規律に統一し、
`hasPub` / `hasCol` / `colFlag` / `has(k)` を用意した。サンプルの `app.json` にも
`collections` と `participantRead` を明示した。

**8. 匿名認証（段階 B）が自分の行を読めなかった（3 巡目）。** `ownRow()` が `signedIn()` を
要求し、`signedIn()` は `email_verified == true` を要求していた。**匿名認証にメールは無い**ので、
uid でキーした自分の投稿すら読めない。認証段階の表は「B は uid ベースなら可」と書いていたので、
**表と実装が矛盾していた。**
→ **`authed()`（署名済み・匿名を含む）と `verified()`（検証済みメール）を分離。**
uid ベースの判定は `authed()`、メール比較だけ `verified()`。

**9. 語彙のドリフト（3 巡目）。** 本文は `auth` / `createFields` / 既存の `when` に移行したのに、
断片・リンター表・シナリオ表に `requireAuth` / `submit.fields` / `showIf` /
`currentQuestion` / `currentTopic` が残っていた。**このプランは LLM の参照物なので、
古い語彙が残ることは仕様の二重化そのもの。** → 全て現行語彙に統一（`session` のキーは
`current` に一本化）。

**10. `roleIn()` 自身が無ガードだった（4 巡目）。** `'*'` ロールを持たないメンバー
（S1 の美容師は `{bookings: editor, shifts: viewer, services: viewer}` だけ）に対して
フォールバック `members[email()]['*']` を読むので、**`roleIn` の呼び出しが落ちる**。
症状として最初に見えたのは「美容師が承認してもメールが出ない」（`/mail` の `writerOf(aid,'*')`）
だが、原因は `/mail` ではなく**最も中心の関数**。
→ フォールバックも `in` でガードし、`writerOf(aid, cid)` に一本化。`/mail` は
`request.resource.data.cid` の書き手も通す。

**11. `get().data` を `exists()` なしで読んでいた（4 巡目）。** gated の親が未作成・削除済みだと
評価が落ちる。→ `exists()` を挟み、`revealBy` のキー存在も確認する。

**12. 複合 ID の材料を無検査で連結していた（4 巡目）。** `request.resource.data[cfg().idField]` が
無い、あるいは文字列でないと、連結が型エラーで落ちる。→ キー存在と `is string` を確認。

**13. `members[email()]` をアプリ作成時に無ガードで読んでいた（4 巡目）。**
→ `email() in request.resource.data.members` と `'*' in ...` を先に確認。

**14. ドキュメント側のキー存在を確認していなかった（4 巡目）。** `cfg().emailField` /
`colStatus()` が**宣言されていても、そのレコードに無い**ことがある。
→ `resource.data` / `request.resource.data` 側の存在も確認する。

**15-17. CI レビュー（5-6 巡目）。**

- **`/mail` の縛りが半分だった。** 宛先とテンプレートを固定しても、書き手は
  **どんな状態の記録にでも、何度でも**通知を積めた。アクションと遷移が助言のまま。
  → 決定的な `mailId` で重複を封じ、`get() != getAfter()` で**この書き込みが遷移させたこと**を
  要求。**7 巡目の追撃**: `getAfter()` だけでは「結果その状態である」しか言えず、すでに
  `approved` の予約に何も書かずメールだけ積めた。前後の差を見て初めて
  「送るなら、この書き込みで承認していなければならない」になる
- **`audience: "participant"` が `roleIn(...) != null` だった。** viewer や editor まで
  投稿できる。読み取り専用のつもりで viewer を配ると、その人が投票できてしまう。
  → 厳密一致に
- **S2 のサンプルが `audience` を宣言しながら `members` を持っていなかった。**
  `listed()` が偽になり**アンケートの投稿が全部拒否される**。
  → S2 は `audience` を外す（ログインした人なら誰でも）形に直し、
  名指し配布にする場合の書き方を併記

**19. `window` の ISO 文字列を `request.time` と比較していた（8 巡目）。**
ルールは文字列を timestamp に暗黙変換しないので、型エラーで**アンケートの投稿が全部拒否**。
→ publish が epoch millis（`fromMs` / `untilMs`）に落とし、ルールは
`request.time.toMillis()` と比較する。**あわせて、サンプルが示しているのは
authored な `app.json` であって published な `apps/{aid}` ではない**ことを明記した
（この取り違えが指摘の根にあった）。

**20-21. 宣言された状態機械をルールが持っていなかった（9 巡目）。** 2 件は同じ根。

- **メールが遷移「先」しか見ていなかった。** `writerOf` は無条件に item を更新できるので、
  書き手は `cancelled` / `rejected` の予約を**同じバッチで直接 `approved` に飛ばして**
  `booking-approved` を送れた。アクションの `require`（pending からのみ承認できる）が
  ルールに存在しなかった。
  → `mail.on` を `{from: [...], to: "..."}` にし、**遷移元も宣言どおり**であることを要求。
  さらに `collections[cid].transitions` を publish が出し、**writer を含む全員に**
  状態機械を効かせる
- **客が承認済みの予約を黙って動かせた。** `selfUpdate` が平坦なリストで、現在の状態を
  見ずに `startAt` / `stylist` を許していた。承認済みの予約が別の時間帯に移り、
  `schedule` の busy 判定だけが更新され、**担当者は承認し直していない。**
  → `selfUpdate` を**状態別**にし、`approved` では名前しか触れない
  （動かしたければキャンセルして取り直す）

**共通の教訓**: `require` も `then` も `selfTransitions` も、**publish が
`transitions` に落として初めてルールが効く。** 落とさなければ宣言は助言のまま。

**22. S3/S4 のテンプレートが `memberEmails` を欠いていた（10 巡目）。**
ルートの app ルールは `membersConsistent()`（`memberEmails` == `members.keys()`）を
create/update で要求するので、**コピーしたそのままでは publish できない**。
しかも直前の巡回で S2 に「`members` と `memberEmails` を必ず一緒に宣言する」と書いており、
**二重管理を人に課す方向で塞いでしまっていた。**
→ 逆にした。**`memberEmails` は authored な `app.json` に書かない**。`members` からの
純粋な導出で、`members` を書く経路（publish と招待 UI）が生成する。
`membersConsistent()` は**ずれを書き込めなくする不変条件**であって、人への要求ではない。
S1 のサンプルからも手書きの `memberEmails` を外した。

> ここまでの 3 巡と同じ形に見えるが、向きが逆。**「publish が落としていない宣言」ではなく、
> 「publish が生成すべき導出物を人に書かせていた」。** どちらも
> 「authored と published の境界が曖昧」という同じ原因から出ている。

**23-24. 状態機械の 2 つの抜け道（11 巡目）。**

- **`session` を editor が駆動できた。** `writerOf(aid, '*')` は editor を含むので、
  ロール表が「owner のみ」と書いている `session` を editor が動かせた。
  **`phase: "revealed"` にして正解を開示**したり、投票を勝手に開閉したりできる。
  → `roleIn(aid, '*') == "owner"` に。
- **status を消せば状態機械を迂回できた。** `transitionOk()` の
  `curStatus() == null || nextStatus() == null` は**ガードのつもりが素通り口**で、
  1 手目で status を消し、2 手目で任意の状態に入れば **pending を経由せず approved
  に到達**する。
  → status の削除／null 化を拒否し（`nextStatus() != null`）、すでに status を持たない
  既存レコードは**宣言された復帰口 `initial` にだけ**入れる。

> 2 つ目が今回の教訓。**「null なら素通り」という書き方は、ガードの顔をした穴。**
> 3 巡目から「任意キーは `in` でガードする」と言ってきたが、
> **ガードした先を `true` に倒すか `false` に倒すか**は別の判断で、
> 状態機械では `false`（拒否）が正しい。emulator テストに
> 「status を消す書き込み」を必ず入れる。

**25-26. 12 巡目。**

- **`ownRow()` の前方一致が ID 戦略に束縛されていなかった。** `idFrom: "auto"` の
  コレクション（S1）でも `itemId.matches(uid + "_.*")` が効くので、攻撃者が
  `<被害者uid>_x` という id のレコードを作れば、**被害者に他人のレコードの自己編集権が生える。**
  → `idFrom` ごとに厳密一致へ。複合 id は正規表現ではなく、保存されている値から
  id を復元して比較する（uid に正規表現メタ文字が来ても壊れない）。
  `auto` では所有判定は `emailField` のみ
- **メールの「実際に変化した」検査を落としていた。** `from` / `to` を入れたとき、
  「`from` と `to` は宣言上素だから `get() != getAfter()` は不要」と考えて外し、
  **素であることをリンター項目にした。**
  → 戻した。両方要求する。

> **リンターはルールの代わりにならない。** リンターは作者の手元で、authored な宣言に対して
> 一度走る。ルールは**すべての書き込みに対して**走る。ルールが依存している事実を
> リンターに移した時点で、その事実は**保証ではなく期待**に落ちる。
> 「静的検査に移したから安全」は、ここでは成立しない。

**27. S4 の `voter` がクライアント申告だった（13 巡目）。** `createFields` に `voter` が
入っている一方、`emailField` で固定していなかったので、**議員 A が議員 B の名前で投票できた。**
`immutable` なので取り消せず、`peerVisibility: "public"` なのでそれが公式の記録として
全員に見える。**記名投票の「記名」が申告制では、記名投票ではない。**
→ S4 に `emailField: "voter"` を宣言（`voter` の型も `email` に）。
**新しい語彙は要らなかった** — `authOk()` が既に
`request.resource.data[emailField] == email()` を強制しており、S1 では最初から使っていた
機構を S4 が使っていなかっただけ。

> 一般則: **表示される身元をクライアントに書かせるなら、`emailField` で固定する。**
> 固定しないなら持たせず、**ドキュメント id（`{uid}_…`）を身元とする**。
> `immutable` と `peerVisibility: "public"` が重なるコレクションでは、
> この取り違えは**永久に公開される誤帰属**になる。

**28. 集計キーが未検査だった（14 巡目）。** S2 の `q2` は `aggregate.by` に載る一方
`number` 型で、値の検査が無かった。直接クライアントが `q2: "not-a-score"` を投げれば、
それが**公開された集計の 1 グループになる**。
私はこれを「守れないもの（任意フィールドの型）」の表に入れて済ませていたが、
**集計キーはその中の特別な部分集合**だった — 他のフィールドの型違いは
「そのレコードが変」で終わるのに対し、**集計キーの型違いはアプリ全体の出力を壊す。**
→ `choiceField`/`choiceValues`（1 つ）を **`keyFields`（最大 2、インデックス展開）** に一般化し、
リンターの不変条件 **`aggregate.by` ⊆ `keyFields` ∪ `gateOn.match` ∪ `statusField`** を置いた。
S2 の `q2` は `enum` に変えた。

> 上限 2 が実務でほぼ効かない理由: 集計結果は 1 MiB のドキュメントに収まる必要があり、
> **集計キーは低カーディナリティでなければならない**。自由な数値でグループ化する設計自体が誤り。

**29. create に状態機械が掛かっていなかった（15 巡目）。** `transitionOk()` を
`allow update` にしか適用しておらず、`allow create` の writer 分岐は無条件だった。
S1 の美容師は**最初から `status: "approved"` の予約を作れる** — 宣言された
`initial → pending` を一度も通らずに、承認済みの記録が生まれる。
→ `initialOk()` を作り、**create の両方の分岐**（writer と公開投稿）に適用した。

あわせて `statusField` の出所を整理した。submit 設定と mail 設定の 2 箇所に持たせて
いたので、**食い違うと検査が静かに外れる**。`collections[cid].statusField` を単一の
出所にし、submit 側は `initialStatus`（値）だけを持つ。

> 状態機械を後から足したときの典型で、**「遷移」は書いたが「生成」を忘れた**。
> 状態機械は辺（transition）だけでなく**入口（initial）も持つ**、というだけの話が、
> 実際には create と update の 2 経路に分かれて現れる。

**30. writer の近道が投稿経路の検査を全部飛ばしていた（16 巡目）。** `allow create` の
第 1 分岐 `writerOf(aid, cid)` は、`authOk()` / `emailField` / `idFrom` / `gateOn` /
`validate` を**すべて迂回する**。S4 では**議長（と editor）が、他の議員の名前で、
任意の topicId に、投票終了後でも、永久に消えない票を作れた。**

これはプラン自身のテーゼに直接反する。`immutable` を入れた理由は
「議長が票を書き換えられる投票システムは投票システムではない」だったが、
**捏造できるなら同じこと** — `immutable` は「書き換えられない」を保証するだけで、
「捏造できない」は保証しない。
→ **`collections[cid].submitOnly`** を追加。true のコレクションは owner/editor でも
直接作成できず、必ず投稿経路を通る。あわせて `validateOk()` を切り出して
**create の両方の分岐**に効かせた。

主催者自身が参加する場合（議長も投票する）は、**コレクション別ロール**で解く:
`{"*": "owner", "votes": "participant"}`。`roleIn` は cid を先に見るので、
議長は votes においてのみ participant として振る舞う。

> **信頼されたロールは、権限の上限であって検査の免除ではない。**
> 「owner なんだから通してよい」と書いた分岐が、その owner から守るための
> 仕組み（`immutable`、記名、締切）を全部無効化していた。

### 同じ形のバグが 3 巡続いた（4 巡目も同じだった）

**4 巡で 10 件が同じ根っこ**だった:

> **ルールを「サンプルに書いたキー」に対して書いており、「宣言言語の任意性」に対して
> 書いていなかった。**

`emailField` を宣言しないアプリ、`participantRead` を持たないアプリ、`collections` に
エントリの無いコレクション — どれもサンプルの外側にあり、机上では見えない。
**Firestore ルールでは存在しないキーの参照が fail closed になるので、症状は
「権限エラー」ではなく「なぜか何も出ない」になる。**

したがって規律を 2 つ置く:

1. **任意キーは必ず `in` でガードしてから読む。** 例外なし。
   **宣言（`cfg()` / `app()`）側だけでなく、ドキュメント（`resource.data`）側も**
2. **`get().data` の前に必ず `exists()`。** 参照先が消えているのは正常系
3. **文字列連結の材料は `is string` を確認する**
4. **emulator のユニットテストは、以下を必ず含める。**
   4 シナリオが全部通っても、これらが無いと同じ穴が開く:
   - キーを宣言しないアプリ（`public` / `collections` / `participantRead` 無し）
   - `'*'` ロールを持たないメンバー（コレクション別ロールだけの人）
   - 親が存在しない gated ドキュメント
   - 宣言されたフィールドを持たないレコード
   - **status を消す / null にする書き込み**（状態機械の迂回）
   - **global `editor` が `session` を書こうとする**

> **3 巡目でこの規律を書いた当人が、4 巡目に `roleIn()` — 最も中心の関数 — で同じことを
> していた。** 規律を書くだけでは足りず、**テストに落とすまで守られない**という証拠。

あわせて、**名簿（`members`）そのものを `participant` に読ませない**ようにした
（同級生のメールが見える）。ルールの `get()` は read ルールの影響を受けないので、
`apps/{aid}` の read を `reader()` に絞っても判定は壊れない。公開設定は
`apps/{aid}/config` に分けて置く。

### ルールが保証できること

| 保証 | どう |
|---|---|
| `memberEmails` と `members` の一貫性 | `.keys().toSet()` 比較。**ずれた状態が書き込めない**（`memberEmails` は導出物で、人は書かない） |
| 所有者が移らない | `resource.data.owner` と比較 |
| メンバー表を owner 以外が触れない | `roleIn(aid,'*') == "owner"` |
| publish が owner 限定 | collections の write が owner 限定なので自動的に満たされる |
| 申込みのフィールドと初期ステータス | `hasOnly` + 宣言された `initialStatus` |
| 申込者のなりすまし防止（C のとき） | `emailField == request.auth.token.email` を強制 |
| 申込者が他人の申込み/回答を読めない | 行レベル（`emailField == email()` / `itemId == uid`） |
| **一人一回** | `idFrom` + `allow create` が既存ドキュメントに適用されない性質 |
| **締切** | `request.time` と宣言された `window` の比較 |
| **正解の秘匿** | `gated` によるコレクション分割 + `revealed` フラグでの read 制御 |
| **カンニング防止** | `session.current` / `session.phase` を create 条件に入れる |
| **記録の改竄不可（owner を含む）** | `immutable` → `allow update, delete: if false` |
| **過去トピックへの投票を弾く** | create 条件に `session.current == topicId` |
| 巨大ドキュメントの拒否 | `request.resource.data.size()` |
| メール踏み台の防止 | 宛先は**その記録が持つアドレス**、テンプレートは**宣言された `on` のキー**のみ |
| **メールが宣言された遷移に伴っていること** | 決定的な `mailId` で重複を封じ、`get() != getAfter()`（実際に変化した）と `from` / `to`（宣言どおりの遷移）の**両方**を要求 |
| 自分の行の判定が ID 戦略と一致 | `idFrom` ごとに厳密一致。前方一致を無条件に許さない |
| **表示される身元が申告でないこと** | `emailField` が指すフィールドは `request.auth` のメールと一致していなければならない |
| 宣言した audience と認可の一致 | `roleIn(...) == "participant"`（`!= null` では viewer も投稿できる） |
| `session` を駆動できるのは owner だけ | `roleIn(aid, '*') == "owner"`（`writerOf` は editor を含む） |
| **status を消して状態機械を迂回できない** | `nextStatus() != null` を要求し、null の既存レコードは宣言された `initial` にだけ入れる |
| **create も宣言された初期状態からしか始まらない** | `initialOk()` を create の**両方の分岐**に適用（writer も公開投稿も） |
| **記録を捏造できない** | `submitOnly` のコレクションは owner/editor でも直接作成できず、投稿経路（`authOk` / `idFrom` / `gateOn` / `emailField` / `validate`）を必ず通る |
| 値の検査が writer 経由でも効く | `validateOk()` を create の**両方の分岐**に適用 |
| 公開投稿の必須と**集計キーの値** | `hasAll(validate.required)` / `keyFields[i].values.hasAny([...])` |

### authored な `app.json` と published な `apps/{aid}` は別物

サンプルが示しているのは**リポジトリに書く `app.json`**（人が読み書きする形）で、
Firestore の `apps/{aid}` は **publish が導出した別のドキュメント**。混同すると
「サンプルどおりに書いたのにルールが通らない」になる。

| authored（git） | published（Firestore） | なぜ変わるか |
|---|---|---|
| `window.from` / `window.until`（ISO 文字列） | `window.fromMs` / `window.untilMs`（**数値**） | **ルールは文字列を timestamp に変換しない。** ISO 文字列と `request.time` を比較すると型エラーで fail closed |
| 各コレクションの `schema.json` | `publishedSchema`（そのまま） | ルールは読まない。クライアントが描画に使う |
| **`app.json` の `collections[cid]`**（`statusField` / `transitions` / `immutable` / `submitOnly` / `peerVisibility` / `revealGated` / `gatedFrom` / `revealBy` / `mail` / `aggregate`） | `collections[cid]`（そのまま） | **いまは authored**。下の「導出はまだ入っていない」を読むこと |
| `members` | `members` + **`memberEmails`（導出）** | 「自分が参加しているアプリ」を `array-contains` で引くための非正規化。**人が書くものではない** — `members` を書く経路（publish、招待 UI）が必ず一緒に生成し、ルールの `membersConsistent()` がずれを拒否する |
| `public.read` / `participantRead` | **変わらない（リストのまま）** | ルールは `cid in a.public.read` で見る。rules 言語の `in` はリストなら要素、マップならキーを見るので**どちらでも通る** — だからこそ片方に決める必要があり、**publish は authored の形（リスト）をそのまま出す**。mulmoserver の `test/rules/rules_publish.ts` が実行して固定している |
| フィールド定義（型・required・enum） | `public.submit[cid].validate` | ルールには反復が無いので、検査できる部分集合だけ |
| — | `publishedCommit` / `publishedBy` / `publishedAt` / `previousPublished` | 記名と rollback |

**epoch millis を選び、Firestore の `Timestamp` 型にしない理由**: `app.json` は JSON で、
`Timestamp` は JSON で表現できない。数値なら authored 側も published 側も同じ形で書けて、
エージェントが生成した JSON をそのまま検証できる（サンプル節の JSON 全数検証が成り立つのも
これのおかげ）。

> **導出はまだ入っていない（実装順 5 の実際）。** この表は当初
> `actions[].then.email` → `collections[cid].mail`、`actions[].require` + `set` →
> `statusField` + `transitions` の導出を書いていたが、**読むべき schema キーが存在しない** —
> `schemaZ` に `require` と `set` はあるが `then` は無く、`immutable` / `peerVisibility` /
> `submitOnly` / `aggregate` も無い。追加は実装順 10（`.strict()` 化）の決着待ちなので、
> いまそれらは **`app.json` の `collections[cid]` に authored** する。
> schema が宣言を持てるようになったら、導出が authored の腕を**置き換える**（並存ではない）。
> 下の語彙表が `immutable` / `peerVisibility` / `gated` / `aggregate` を schema のキーとして
> 挙げているのは**将来の置き場所**であって、現状ではない。

> **これが D4「publish はコンパイル段階である」の 3 つ目の実例。** git の宣言を、
> ルールが読める射影に落とす。**変換は必ずここに書く** — 暗黙の変換が 1 つでもあると、
> 「サンプルどおりで動かない」が再発する。

### `audience` は投稿経路しか縛らない（実行して分かったこと）

`public.submit[cid].audience: "participant"` は **`allow create` の公開投稿分岐にしか
現れない**。owner / editor は `writerOf` の分岐で create するので `audience` に一度も
出会わない。つまりアンケートでも投票でも、**主催者は好きなだけレコードを足せる。**

これを塞ぐのは `audience` ではなく **`submitOnly`**（S4 が記録の捏造防止のために
入れたもの）。

**不変条件（`audience` の有無ではない）:**

> **`public.submit[cid]` が、レコードを投稿者の身元に束縛しているなら、その
> `collections[cid]` は `submitOnly: true` を宣言しなければならない。**
>
> 束縛しているとは、次のいずれかが宣言されていること:
> `idFrom: "auth.uid"` / `idFrom: "auth.uid+field"` / `emailField` / `audience: "participant"`。

なぜこの形か。束縛が宣言されているということは、**そのレコードは「投稿者本人が出した」以外の
意味を持たない**ということである（一人一回の回答、記名投票、自分の予約）。ところが writer 経路の
create はその束縛を一度も通らないので、owner / editor が**誰の名前でも**同じ形のレコードを
作れてしまう。`immutable` の有無は関係ない — S2 の回答は immutable ではないが、水増しは
同じように成立する（`immutable` を条件にすると S2 が漏れる）。逆に、束縛の無い投稿フォーム
（S1 の予約の初期案のような、スタッフも代理入力する台帳）は `submitOnly` にすべきではない。

**リンターの警告ではなく publish が拒否する。** 理由はルール本体と同じで、
**リンターは作者の手元でしか走らない**。publish は D4 の言うコンパイル段階であり、
Firestore に何が載るかを決める唯一の関門なので、検査はそこに置く（実装順 5）。
`putSchema`（スキーマの書き込み）でも同じ検査を通すが、そちらは**早く気づかせるため**で
あって、保証しているのは publish のほう。

ルールはこの不変条件を強制できない — 「このコレクションは投稿を受けるためのものだ」は
宣言の意図であって、書き込み 1 件を見て判定できることではないから。**ルールが守るのは
`submitOnly` が宣言された後**（owner / editor の直接 create を拒否する）で、
**宣言し忘れを捕まえるのが publish**。

emulator テスト `rules_scenarios.ts` の S2 と S4 が、この 2 つの区別を固定している。

### 公開投稿の値検証は、どこまでできるか

**`hasOnly(createFields)` はフィールド「名」しか見ない。** 必須の欠落、型違い、enum 外の値、
壊れた ref は素通りする。そして**公開投稿ではクライアントが攻撃者**なので、
「3 層の検証」の第 2 層（クライアント側 `validateRecordObject`）は**存在しないのと同じ**。

**Firestore ルールには反復が無い。** `{field: type}` のマップを回して型検査する、が書けない。
したがって任意スキーマの完全な検証は**原理的に不可能**。

publish 時に**ルールで検査可能な射影**を app ドキュメントへ出し、そこまでを守る:

```json
{
  "validate": {
    "required": ["topicId", "voter", "choice", "status"],
    "keyFields": [{ "field": "choice", "values": ["yes", "no", "abstain"] }]
  }
}
```

**`keyFields` は「集計キー」**。ここが未検査だと、`q2: "not-a-score"` のような値が
そのまま `aggregate.by` のグループになり、**公開された結果が汚染される**。
他のフィールドの型違いは「そのレコードが変」で済むが、**集計キーの型違いは
アプリ全体の出力を壊す**ので、守る側に置く。

ルールに反復が無いので**インデックスで明示的に展開し、上限を 2 とする**。
これは実務上ほぼ制約にならない — 集計キーは 1 MiB のドキュメントに収まる必要があり、
**低カーディナリティでなければならない**（無制限の数値でグループ化してはいけない）。

**リンターの不変条件**: `aggregate.by` の各フィールドは、
`validate.keyFields` に載っているか、`gateOn.match` で固定されているか、`statusField`
のいずれかでなければならない。S3 / S4 の `questionId` / `topicId` は `gateOn` が
`session.current` と一致させるので、この条件を満たしている。

| 守れる | 手段 |
|---|---|
| 余分なフィールドが無い | `hasOnly(createFields)` |
| 必須が揃っている | `hasAll(validate.required)` |
| 初期ステータスが宣言どおり | `statusField == initialStatus` |
| **集計キーの値**（最大 2、投票の賛否、小テストの選択肢、尺度回答） | `keyFields[i].values.hasAny([...])` |
| ドキュメントが巨大でない | `data.size() <= 200` |

| 守れない | 受け方 |
|---|---|
| 任意フィールドの型 | 集計時に除外 + ホストの `validateCollectionRecords` で事後掃除 |
| 3 つ目以降の enum / 文字列長 / 正規表現 | 同上。**集計キーは 2 つまで**という制約に落とす（低カーディナリティが要るので実務上ほぼ効かない） |
| ref の実在 | `get()` が 10 回上限なので全 ref は見られない。壊れた ref は表示側で欠落として扱う |
| 大量投稿 | **App Check**（ルールにレート制限は書けない）+ `audience: "participant"` |

**設計上の含み**: 公開投稿を受けるコレクションは**検疫されたもの**として扱う。
`initialStatus` で入り、owner/editor と本人以外には見えず、**承認されるまで下流が信用しない**。
S1 の `pending → approved` はまさにそれで、S2/S3/S4 では**集計が不正レコードを除外する**。

> これは「publish はコンパイル段階である」（D4）の 2 つ目の実例。
> git のスキーマから、**ルールが読める形に落とした射影**を出す。

### ルールが保証できないこと

**1. スキーマに沿ったフィールド検証** — 動的スキーマなので不可能。3 層で受ける:

| 層 | 誰が | 何を |
|---|---|---|
| ルール | Firestore | メンバーシップ、ロール、不変フィールド、粗い形 |
| クライアント | MT / webview | `validateRecordObject`（助言的） |
| 事後 | オーナーのホスト | `validateCollectionRecords` → `recordFieldProblem` を UI に出す |

前提: **editor は「招待した信頼できる人」であって敵ではない。** 置けないなら Functions が要り、
それは mulmoserver の方針転換になる。既定を viewer にして先送りする。

**2. フィールド単位の可視性** — Firestore の読み取りは全部か無か。「viewer には金額列を見せない」を
やるなら**ドキュメント分割**しかなく、レコードが増えてからでは移設になる。

**シナリオ 3（正解の秘匿）が、これを必須にした。** → `gated` として宣言で表現し、エンジンが
分割を生成する（「ライブ・段階的公開・非対称な可視性」参照）。**やらない、という選択肢は消えた。**

### `get()` の予算と、クライアントのクエリ

- **`get()` / `exists()` は 1 リクエストあたり 10 回**（クエリは 20 回）。同一パスの重複は
  キャッシュされるので、ここで使う相異なるパスは **app ドキュメント / `session` / gated の親**の
  最大 3。余裕はあるが、条件を足すときは数える
- **`list` クエリは、ルールの条件をクライアントの `where` が写していないと通らない。**
  `ownRow()` は `resource.data[emailField]` を見るので、参加者が自分の行を一覧するには
  **`where(emailField == 自分)` を発行しなければならない**。ルールは「フィルタを補ってくれる」
  ものではなく「クエリが十分に絞られているか」を見る
  → **View Bridge の親側がクエリを組み立てるので、この規律は親の中で守り切れる。**
    生成された HTML にクエリを書かせない設計が、ここでも効く

### 注意点

- **`get()` は課金される**。単一ドキュメント要求で最大 10 回。ここでは 1 回だが、タダではない
- **匿名 create（段階 A / B）はスパムの入口**。ルールはレート制限を書けない → **App Check**
  （静的な設定）が公開フォームを持つ以上、最初から要る。段階 C でも App Check は有効だが、
  身元があるぶん事後のブロックが効く
- **このルールファイルは凍結インフラ**。ここに書けないことは製品として持てない

---

## 申込みの認証段階（`public.submit[cid].auth`）

> **オーナー判断（2026-08-10）: 匿名申込は許さない。** 段階 A（`"none"`）と B（`"anonymous"`）は
> **採用しない** — 公開投稿は常に段階 C（`verifiedEmail`）。
> **ルールは変えない**（3 段階すべてを表現できる状態でデプロイ済みの凍結インフラであり、
> 削ると商売判断が変わったときに cross-repo デプロイをやり直すことになる）。
> 制約は**宣言側の不変条件**として、publish の事前検証（実装順 5）とリンター（実装順 18）が
> `auth` に `"none"` / `"anonymous"` を書いたアプリを拒否する形で置く。
> 下記の表と得失は、なぜ C なのかの記録として残す。

匿名申込みを許すかは、技術ではなく**商売の判断**（ログインを要求すると一定数が離脱する）。
アプリごとに宣言し、ルールは 3 段階すべてを表現できるようにしておく。

| 段階 | `auth` | 認証 | email | 自分の申込みを見る | 濫用対策 |
|---|---|---|---|---|---|
| **A. 完全匿名** | `"none"` | なし | フォーム入力・未検証 | 不可（メール一方通行） | App Check + `public.enabled` |
| **B. 匿名認証** | `"anonymous"` | Anonymous Auth | 未検証 | uid ベースなら可 | App Check + uid |
| **C. ログイン必須** | `"verifiedEmail"` | Google 等 | **検証済み**（`emailField` を宣言したときのみ強制一致） | **可** | 身元があるのでブロック可 |

> **boolean ではなく enum である理由。** 初稿は `requireAuth: true/false` だったが、
> (1) 段階 B が表現できない、(2) `requireAuth: true` かつ `emailField` を宣言しないアプリ
> （アンケート・小テスト・投票）で**投稿が全部拒否されていた** — ルールが存在しないキーを
> 参照して落ちるため。`emailField` の一致強制は「宣言したときだけ」に切り離した。

```json
// app.json
"public": {
  "read": ["services", "shifts", "stylists"],
  "submit": { "bookings": {
      "auth": "verifiedEmail",
      "emailField": "customerEmail",
      "fields": ["customerName","customerEmail","service","stylist","startAt","status"],
      "statusField": "status", "initialStatus": "pending" } }
}
```

### C を選ぶと 3 つ得られる

1. **メールが検証済みになる** — 承認メールが届かない・打ち間違いが構造的に消える
2. **申込者が principal になる** — 行レベルのルールで「自分の申込みだけ読める」が書け、
   **「マイ予約」ページが成立する**（状況確認・キャンセル・変更）。メール一方通行だったものが
   双方向になる。**プロダクトの質が一段変わる**
3. **スパム中継の経路が閉じる** — 匿名だと、攻撃者が被害者のアドレスと攻撃的な本文で申し込み、
   承認されると**サロンのドメインから被害者に攻撃者の書いた内容が飛ぶ**。手動承認なら気づくが、
   自動承認や大量なら通る。C なら `customerEmail == request.auth.token.email` を
   **ルールで強制できる**ので穴が消える

### 失うもの

**コンバージョン。** 髪を切るのに Google アカウントを要求すると離脱がある。サロンのオーナーが
決めること。**A で始めて、迷惑予約が出たら宣言の 1 行で C に上げる**運用ができるのが要点。

---

## 一人一回・書き切り・期限・集計（シナリオ 2）

アンケートが要求し、予約が要求しなかったもの。いずれも汎用機構として入れる。

### `idFrom` — ドキュメント ID を身元にする（一人一回）

Firestore の `allow create` は**存在しないドキュメントにしか適用されない**。回答のドキュメント ID を
回答者の uid にすれば、2 回目の送信は「既存ドキュメントへの create」となり**ルールが自動で弾く**。
専用の重複チェックが要らない。

「1 人 1 票」「1 人 1 エントリー」にも効く汎用機構。

### `finalize` — 送信後は本人が編集できない

**2 つのシナリオが逆を要求するので、フラグにする必要がある。**

- アンケート（`finalize: true`）— 回答は書き切り。本人の update は成立しない
- 予約（`finalize: false`）— **マイ予約からキャンセル・変更できる**（段階 C の価値の一部）

本人の update は「自分の行 かつ 宣言されたフィールドの範囲 かつ 期限内」に限る。
owner/editor はどちらでも修正できる。

### `window` — 開始・締切をルールで持つ

`request.time` をアプリドキュメントの `until` / `from` と比較する。**クライアントの善意に頼らず
締切が効く。** 予約にも使える（「予約は 30 日先まで」）。

### `aggregate` — 集計の公開

回答者は他人の行を読めない（読めたら台無し）ので、**集計はルールでは作れない**。
オーナー（またはホスト）が集計して 1 つのドキュメントに書き、それを公開する。

```json
"aggregate": { "from": "responses", "publish": "results",
               "by": ["q1", "q2"], "visibility": "public" }
```

**結果はライブである必要がない**ので、D7（ホストは実行経路にいない）を壊さない。

### 宣言の例

```json
// app.json
"public": {
  "read": ["questions", "results"],
  "submit": { "responses": {
      "auth": "verifiedEmail",
      "idFrom": "auth.uid",
      "finalize": true,
      "window": { "until": "2026-09-30T23:59:59Z" },
      "createFields": ["q1","q2","q3","submittedAt"],
      "selfUpdate": {},
      "statusField": "status", "initialStatus": "submitted" } }
}
```

### 両立しないもの（明記して「やらない」と決める）

> **「一人一回」と「オーナーに対して匿名」は、この構成では両立しない。**

一人一回のためには身元がドキュメント ID になっている必要があり、オーナーはそのドキュメントを
読めるので匿名は嘘になる。ハッシュ化しても鍵がクライアントにある以上、意味がない。
**本物の匿名アンケートにはサーバー（Function）が要る。** できそうに見えてできない類なので、
ドキュメントに明記する。

---

## ライブ・段階的公開・非対称な可視性（シナリオ 3）

### 最重要: `gated` — フィールド単位の可視性は「ドキュメント分割」で実現する

三択問題を公開スキーマに置くと、**`correctChoice` もクライアントから読める**。生徒はネットワークを
見れば全問正解できる。そして**Firestore の読み取りは全部か無かで、ルールでフィールドは隠せない**
（「ルールが保証できないこと」参照）。

> **問題文・選択肢と、正解は、別コレクションに分けるしかない。**

```text
questions/{qid}   問題文 + 3 択          public read
answerKey/{qid}   正解 + 解説            revealed == true のときだけ read
```

**これをエージェントの記憶に頼ってはいけない。** 分割し忘れても動く。テストも通る。
**授業で生徒が満点を取るまで誰も気づかない。** だから宣言で表現し、エンジンが分割を生成する:

```json
// questions/schema.json
"gated": { "fields": ["correctChoice", "explanation"], "revealBy": "revealed" }
```

チェックリストの「フィールド単位の可視性 — やらないと決めるか、ドキュメント分割を今入れるか」は、
**シナリオ 3 が答えを出した: 入れる。** そして**セキュリティを人間の注意力ではなく宣言に持たせる**
のは、テーゼ（宣言的で狭いことが統治を可能にする）の実例でもある。

### `session` — 主催者がペースを握る状態機械

```text
apps/{aid}/session   { current: "q3", phase: "answering" | "revealed" | "closed" }
```

これまで扱ってきたのは全てレコードだったが、これは**ランタイムの状態**という新しい概念。
回答の受付もこれで縛る（ルールで `session.current == 回答の qid`
かつ `session.phase == 'answering'`）。**締切後の回答 = カンニングが構造的に不可能になる。**

- write: owner/editor（先生）のみ
- read: participant 以上

### `live` — ライブリスナーを宣言で切り替える

「公開ページは `onSnapshot` ではなくキャッシュ付き単発取得」（監視点 4）は**コスト都合の既定**で、
シナリオ 3 では**ライブが必須**。ビューまたはコレクションに `live: true` を宣言できるようにし、
既定は非ライブのままにする。

### `aggregate` のトリガー — 正答率は先生のブラウザが計算する

生徒は他人の回答を読めないので集計できない。**owner のブラウザ**が集計して `stats` ドキュメントに
書き、生徒はそれを読む。**ホストの Mac は関係ないので D7 は保たれる**（主催者のブラウザは
参加者であって、ビルド経路ではない）。

シナリオ 2 の `aggregate` に「フェーズ遷移で再計算」というトリガーを足す:

```json
"aggregate": { "from": "responses", "publish": "stats",
               "by": ["questionId", "choice"], "on": "session.phase == 'revealed'",
               "visibility": "participant" }
```

### 非対称な可視性のまとめ

| | 先生（owner） | 生徒（participant） |
|---|---|---|
| 問題文・選択肢 | 見える | 見える |
| 正解・解説 | 常に見える | **`revealed` の後だけ** |
| 自分の回答 | 見える | 見える |
| 他人の個別回答 | **見える** | 見えない |
| 全体統計 | 見える | 見える（`stats` 経由） |
| 全生徒の成績一覧 | **見える** | 見えない |

**全て既存の機構（行レベル read + `gated` + `stats` の publish）で表現でき、新しいルールの
形は要らない。** 要るのは `gated` の分割生成と `participant` ロール。

### `participant` ロール — 3 つのシナリオに共通する穴

生徒は member ではない（member にすると他人のデータが見える）。かといって
「リンクを知っている誰でも」では隣のクラスの生徒が入れる。

**「名指しされているが member ではない」層が、今の 3 値（owner / editor / viewer）に無い。**

```text
owner        publish、メンバー管理、session の駆動、全件読み取り
editor       レコードの読み書き（全件）
viewer       レコードの読み取り（全件）
participant  submit + 自分の行 + public/gated-revealed のみ。全件は読めない
```

**これはシナリオ 2 にも効く** — 「社内の特定メンバーだけに配るアンケート」が今は書けない。
シナリオ 3 が前の 2 つの穴を照らした形。

---

## 記録の完全性と公開投票（シナリオ 4）

### `immutable` — オーナーにも書き換えられない記録

**設計の最大の欠落。** 現在のルールは owner/editor がいつでも item を update / delete できる。
**投票記録としては失格** — 議長が後から票を書き換えられる投票システムは、投票システムではない。

```json
"immutable": true   // create のみ。update / delete は誰も不可（owner も）
```

ルールでは `allow update, delete: if false` の一行。**「オーナーですら触れない」というカテゴリが
設計に無かった。** 議会以外にも効く: 監査ログ、同意の記録、検査結果、会計の仕訳。

### `peerVisibility` — 記名投票なら公開が正しい

議会の投票は普通**記名投票（roll call）**で、誰がどう投じたかは記録に残る。
つまり参加者は**全員の票を読める**。

これが決まると**リアルタイム集計の難問が消える。** シナリオ 3 では「生徒は他人の回答を読めないので
owner のブラウザが集計して publish する」必要があったが、議会では**各議員のブラウザが自分で数えられる。**

> **集計を担う信頼された計算機が要らない。議長のタブが閉じていても票数は正しい。**

投票システムとしてこれは本質的な性質。宣言で切り替える:

```json
"peerVisibility": "hidden"   // 授業・アンケート（既定）
"peerVisibility": "public"   // 議会
```

`public` のときは `allow read: if roleIn(aid, cid) != null`（参加者なら全件読める）。

### `aggregate.visibleFrom` — 集計をいつ見せるか

シナリオ 3 は「主催者が明かすまで見せない」、シナリオ 4 は「投票中からリアルタイム」。
**同じ機構で方針が逆。**

投票中に途中経過を見せるのは**バンドワゴン効果を生む**という設計判断でもある（議会では意図的に
そうすることも、避けることもある）。だから宣言で持つ:

```json
"aggregate": { "visibleFrom": "during" | "revealed" | "never" }
```

`peerVisibility: "public"` なら集計は各クライアントが計算するので、`stats` の publish 自体が不要。

### 戻って変えられない

`finalize: true` に加えて、**create 条件に `session.current == 投票の topicId`** を入れる
（シナリオ 3 と同じ機構）。過去のトピックへの投票は**ルールが弾く**ので、
クライアントの善意に頼らない。

### 秘密投票は範囲外（2 度目の同じ限界）

無記名投票にしたいなら、既出の限界に**2 度目に突き当たる**:

> **「一人一回」と「主催者に対して匿名」は両立しない。**

一人一票を保証するには身元がドキュメント ID になっている必要があり、owner はそれを読める。
**秘密投票にはサーバー（Function）が要る。記名投票は可、無記名投票は範囲外**と明記する。

---

## 宣言的な副作用（メール）

承認メールをホストに送らせると **D7 が壊れる**（オーナーがスマホから承認したとき Mac は寝ている）。

**Firebase の Trigger Email 拡張**を使う。`mail` コレクションにドキュメントを 1 つ書くと送信される。
カスタム Function のコードはゼロ（mulmoserver の「Functions を避ける」方針と実質的に整合）。

```json
// bookings/schema.json
"actions": {
  "approve": {
    "kind": "mutate",
    "set": { "status": "approved" },
    "then": { "email": { "to": "{{customerEmail}}", "template": "booking-approved" } }
  }
}
```

**`then.email` という宣言的な副作用**が、現設計に足りていないピース。入れると通知・リマインダー・
キャンセル連絡が全部同じ機構に乗る。

> **宣言はクライアントが実行するので、ルールが独立に再導出しなければ意味がない。**
> `then.email` を宣言しただけでは、書き手が `/mail` に任意の宛先・任意の内容を積める
> （サロンのドメインからのスパム中継）。publish は `collections[cid].mail`
> （`toField` / `statusField` / `on` / `dataFields`）を出し、ルールは 4 つを強制する:
>
> - **宛先 = その記録が持つアドレス**
> - **テンプレート = 宣言された `on` のキー**
> - **自由文は `dataFields` のみ**
> - **そのテンプレートが宣言する遷移が、この書き込みで起きたこと**
>   （`get() != getAfter()` かつ `getAfter() == on[template]`）
>
> 最後の 1 つが要点で、しかも**二段階で正しくなった**:
>
> 1. 宛先とテンプレートだけ縛っても、書き手は**どんな状態の記録にでも何度でも**積める
>    → 決定的な `mailId`（`{cid}_{itemId}_{template}`）で重複を封じる
> 2. `getAfter()` だけでは**「結果その状態である」しか言えない**。すでに `approved` の
>    予約に対して、**何も書かずにメールだけ**積める
>    → `get() != getAfter()` で**この書き込みが遷移させたこと**を要求する
>
> ここまでで **「承認したから送る」が「送るなら、この書き込みで承認していなければならない」**
> になる。クライアントは記録の更新とメールの enqueue を **1 つのバッチ**で書く。
>
> これは一般則: **宣言をルールが再導出できないなら、その宣言は助言でしかない。**

（SMTP 認証情報を 1 回設定する必要がある。コードではないが、セットアップコストではある。）

---

## HTML は生成物、スキーマが統治対象

**この節は、下の「宣言で表現できる範囲」の結論を書き換える。**

当初この計画は「カスタムビューの HTML が革新性の穴とセキュリティの穴を同じ場所に開ける」と
書いていた。危険は 2 つあり、**片方は消える。**

**(a) diff がレビューできない → 消える。** HTML が**スキーマの射影**であれば、そこに真実は無い。
使い捨てで、いつでも再生成できる。**ビルド成果物であってソースではない。** レビュー対象は git の
スキーマだけになる。保つべき規律は 1 つだけ:

> **HTML は、スキーマが持っていない真実を持ってはならない。**

これさえ守れば、LLM が毎回違う HTML を生成してよい。

**(b) メンバーのブラウザでコードが動く → 残る。** ゆえに sandbox iframe に隔離し、
**Firestore のハンドルを渡さない。** データは親フレームが渡し、生成された HTML は描画だけする。
これは「HTML を制限する緩和策」ではなく、**「自由に生成してよくするための前提条件」**。位置づけが逆。
その仕組みが **View Bridge**（下記）— ハンドルを渡さないままリアルタイムを実現する標準機構。

### なぜ生成された HTML を信頼しなくてよいのか

> **アクセス制御がデータ層で効いているから。**

シナリオ 3 の `gated` が効くのはこれ。正解が別コレクションにありルールが読ませないなら、
**ビューが何をしようと正解は取れない。** 逆に正解が読めるところに置いてあれば、どんなに行儀のいい
ビューを書いても無意味。

> **ビューの規律はセキュリティに何も寄与しない。ルールとスキーマだけが寄与する。**

**帰結: 統治がスキーマ層に全部移る。** 間違いはすべてスキーマの設計ミスとして現れる。

---

## View Bridge — 親がデータを push し、ビューは Firebase を知らない

sandbox された HTML が Firestore ハンドルを持たなくても、**親フレームが `onSnapshot` で受けた
データを postMessage で push すれば**リアルタイムに動く。これがこの設計の要。

**要点は、親を汎用プロキシにしないこと。** 「このクエリを実行して」を通したら sandbox の意味が消える。

> **ブリッジが公開するのは、宣言された「データセット名」と「アクション名」だけ。
> クエリ言語ではない。**

ルール（データ層）とブリッジ（宣言された面）の**二重防御**になる。

### 構造

```text
+- 親フレーム（webview シェル / MT のセル）-----------------+
|  Firebase SDK・認証・onSnapshot・ref 解決・live 判断      |
|                     | MessageChannel (port)              |
|  +------------------v-----------------------------+      |
|  | iframe sandbox="allow-scripts"                  |      |
|  |  （allow-same-origin なし = origin は null）    |      |
|  |  LLM が生成した HTML — 描画のみ                 |      |
|  +-------------------------------------------------+      |
+-----------------------------------------------------------+
```

`allow-same-origin` を付けないので iframe の origin は `null` になり、**`event.origin` による
検証は使えない。** `MessageChannel` を使い、親が生成した port を最初の握手で 1 回だけ渡す。
**port を持っていることが身元。**

### プロトコル

親 → ビュー（push）:

| メッセージ | 中身 |
|---|---|
| `init` | スキーマ（フィールド、ラベル、i18n）、ロール、テーマ、protocol version |
| `data` | 名前付きデータセットのスナップショット（`{ dataset, items, meta }`） |
| `patch` | 差分（added / modified / removed）。**`CollectionStore` の `StoreChange` 粒度がそのまま乗る** |
| `state` | `session` ドキュメント（`current` / `phase`） |
| `status` | `connecting` / `live` / `stale` / `offline` |
| `result` / `error` | アクションの結果 |

ビュー → 親（request）:

| メッセージ | 中身 |
|---|---|
| `ready` | 握手完了 |
| `subscribe` | 宣言済みデータセットの購読（**宣言外は拒否**） |
| `action` | 宣言済みアクションの実行（**宣言外は拒否**）。親が自分の資格情報で書き、ルールが最終判定 |
| `resize` | 高さ（iframe の自動リサイズ） |

### 宣言

```json
"views": [{
  "id": "board", "type": "html", "file": "views/board.html",
  "datasets": ["questions", "stats"],   // これしか届かない
  "actions": ["vote"],                  // これしか呼べない
  "live": true
}]
```

親は**宣言されたデータセットにしか `onSnapshot` を張らない**。コストの上限も宣言で決まる。

### 副次的に解決するもの

1. **ref を辿る computed field**（監視点 3）— **親が解決してから渡す。** `service.duration` は
   解決済みで届き、ビューに ref キャッシュを持たせる必要が消える
2. **同じ HTML が両方のホストで動く** — 親が違うだけ。MT のセルでも公開 webview でも同じ HTML。
   **LLM は 1 つ生成すればいい**
3. **live か否かをビューが知らなくていい** — 「公開側はキャッシュ付き単発取得、メンバー側はライブ」
   （監視点 4）の使い分けが**親の中に閉じる**
4. **資格情報がビューに一切渡らない** — 公開ページを匿名訪問者に配っても認証情報は漏れない

### 親側でも検証する（ルールだけに任せない）

ビューから届く `action` のペイロードを**そのまま Firestore に流さない**。親が、スキーマの
`actions` に宣言された `mutate` / `set` の仕様、および `createFields` / `selfUpdate` に
照らして**型と許可フィールドを検証してから** SDK を呼ぶ。

ルールが最終防衛線であることは変わらないが、**ルールは理由を返せない**（許可か拒否かだけ）。
親で弾けば、生成された HTML に意味のあるエラーを返せる。

### ref 解決の深さを区切る

親が ref を解決してから push する（監視点 3）が、**深さは最大 2 階層まで**、循環は検出して
打ち切る。`bookings → service → duration` が 2 階層で、実用上ここで足りる。無制限にすると
公開ページのトラフィックで解決コストが読めなくなる。

### 実装上の制約

- **子側ライブラリは依存ゼロで数 KB** — 生成される HTML すべてにインライン展開されるため。
  `mt.on("data", …)` / `mt.action("vote", {…})` 程度の API に絞る
- **その API を LLM が知っている必要がある** — テンプレートとスキルに載せる（生成される HTML の
  品質はここで決まる）
- **protocol version を `init` に含める** — publish された HTML はシェルより古いことがある。
  HTML は再生成できるので致命的ではないが、劣化は graceful に
- **置き場所** — 両ホスト（MT の Vue セル、mulmoserver の webview）が同じ実装を使う必要がある。
  `@mulmoclaude/core` のブラウザ安全エントリ（`./remote-view` / `./plugin-vue` と同じ扱い）に
  `./view-bridge` を足すのが筋。Firebase を import しない（データは親が供給する）ので子側は素の JS

---

## テンプレートとスキーマリンター

### スキーマリンター（新規の成果物）

統治がスキーマ層に移った以上、**機械的に検出できる設計ミス**を潰すのがセキュリティの主戦場になる。
これまで「エージェントの記憶に頼ってはいけない」と繰り返してきたものが、全部リンターの項目になる。

| 検出できるミス | 何が起きるか |
|---|---|
| `public.read` のコレクションに正解・単価などが入っている（`gated` 未指定） | 授業で満点、価格の漏洩 |
| `finalize: true` なのに `idFrom` が無い | 一人一回のつもりが何回でも出せる |
| `peerVisibility: "public"` かつ `auth: "none"` | 匿名の第三者が全件読める |
| `selfUpdate` に管理用フィールド（`status`、`role` 等）が混ざっている | 申込者が自分で承認できる（権限昇格） |
| `public` / `collections` / `participantRead` を宣言しない | ルールが存在しないキーを参照して**全部拒否**（ガード必須） |
| `aggregate.visibleFrom: "during"` かつ `peerVisibility: "hidden"` | 誰が集計するのか未定義 |
| `immutable: true` かつ本人による変更を期待している | 矛盾 |
| `window` があるのに `session` も `finalize` も無い | 締切後の扱いが未定義 |
| `selfUpdate` のどれかの状態に `statusField` が入っている | **本人が自分の承認状態を変えられる（権限昇格）** |
| `selfUpdate` が状態別でなく、承認後も予約枠を触れる | **客が承認済みの予約を黙って移動できる**（枠が移り、再承認されない） |
| `mail.on[t].from` に `to` と同じ状態が含まれる | 設定として無意味（ルール側でも `get() != getAfter()` で拒否されるが、意図の取り違えを早く知らせる） |
| `actions` が `require` を宣言しているのに `collections[cid].transitions` が無い | writer が任意の状態遷移をできる（宣言が助言になる） |
| `transitions` に `initial` が無い | status を持たない既存レコードが**恒久的に書き込み不能**になり、**新規作成も全部拒否**される |
| `initialStatus` が `transitions.initial` に含まれていない | 公開投稿が全部拒否される |
| `transitions` があるのに `collections[cid].statusField` が無い | 状態機械が**静かに無効化**される |
| `transitions` の `initial` が終端状態（`approved` 等）を含む | 復帰口から承認済みを作れる |
| `idFrom` が enum 外の文字列 | ルールが解釈できず、投稿が全部拒否される（または 1 件に潰れる） |
| `gateOn` があるのに `session` を持たないアプリ | create が常に失敗する |
| `then.email` があるのに `collections[cid].mail`（`toField` / `templates`）を publish していない | 承認メールが常に拒否される |
| 公開投稿コレクションに `validate.required` が無い | **必須欠落のレコードを誰でも投げ込める** |
| `audience: "participant"` を宣言しているのに `members` が無い | **投稿が全部 fail closed**（原因が見えない） |
| authored な `app.json` が `memberEmails` を手書きしている | 導出物の二重管理。`members` と乖離した瞬間に publish がルールに拒否される |
| `mail.on` のテンプレートが `actions.*.then.email` と食い違う | 承認メールが常に拒否される |
| `window` の端点が ISO として解釈できない | publish が `fromMs` / `untilMs` を出せず、**投稿が全部拒否される** |
| `aggregate.by` のフィールドが `validate.keyFields` にも `gateOn.match` にも無い | **公開された集計が壊れる。** 直接クライアントが `q2: "not-a-score"` を投げれば、それが 1 つのグループになる |
| `validate.keyFields` が 3 つ以上 | ルールに反復が無いので検査されない（集計キーは低カーディナリティ 2 つまで） |
| `createFields` に身元を表すフィールド（`voter` / `author` / `submittedBy` …）があるのに `emailField` で固定していない | **他人の名前で記録を作れる。** `immutable` + `peerVisibility: "public"` なら誤帰属が永久に公開される |
| `immutable` かつ参加者が投稿するコレクションに `submitOnly` が無い | **owner/editor が記録を捏造できる。** `immutable` は「書き換えられない」だけで「捏造できない」を意味しない |
| `submitOnly` のコレクションで、主催者自身も投稿する必要がある | 主催者に**コレクション別の `participant` ロール**を与える（S4 の議長）。`{"*": "owner"}` だけだと議長が投票できない |
| `icon` が無い / `actions` がオブジェクトマップ | **既存文法エラー**（必須キー欠落・型不一致）。schema が読み込まれない |
| `mutate` に `when`（正しくは `require`） | **エラーにならず黙って消える**。ゲートが外れた状態で動く |

**どれもスキーマだけを見て判定できる。** `putSchema` と publish の両方で走らせる
（publish 側は「ライブデータの検証」と同じ関門）。

> **ただし「パース後」だけでは走らせられない。** `schemaZ.ts` の設計は
> **未知キーをバリアントごとに黙って落とす**（冒頭コメント: "an unknown key is stripped
> per-variant"）。`CollectionObjectZ` は `.strict()` ではない。つまり `immutable` `then`
> `datasets` `gated` のような**新キーは、実装が入るまでパースの時点で消える**し、
> `mutate` に書いた `when` も**エラーではなく消える**。
>
> 帰結は 2 つ:
> - リンターは **生の JSON** を見る必要がある（`acceptParsedSchema` の延長「だけ」では不十分）
> - あるいは新キーの導入と同時に**該当バリアントを `.strict()` にする**。
>   PR #2209 が firestore アームだけ `.strict()` にしたのと同じ判断
>
> **結論: 二者択一ではなく、層が違う。両方要る。**
>
> - **Zod（構造）** — 新キーを定義に足し、該当バリアントを `.strict()` にする。
>   足さなければ新キーはパースで消え、`.strict()` にしなければ `when`/`require` の
>   取り違えが**エラーにならず消える**
> - **リンター（意味）** — 「`selfUpdate` に `statusField` が入っている」
>   「`peerVisibility: public` かつ `auth: none`」のような**関係の検査**は Zod では書けない
>
> 順序だけは決まっている: **Zod 側が先。** 消えるキーを意味検査しても仕方がない。

### テンプレートは「業種」ではなく「形」で索引する

LLM が参照するときに効くのは完成品ではなく、**判断と、間違えたときに何が起きるか**。
4 つのシナリオはパターンとして抽象化する:

| パターン | 形 | 代表的な設定 |
|---|---|---|
| **P1 予約** | リソース × 時間 × 承認 × 通知 | `schedule`, 承認アクション, `then.email` |
| **P2 収集** | 一人一回 × 期限 × 集計 | `idFrom`, `finalize`, `window`, `aggregate` |
| **P3 ライブ授業** | 主催者駆動 × 段階的公開 | `session`, `gated`, `live` |
| **P4 記録** | 不変 × 公開 × ライブ集計 | `immutable`, `peerVisibility`, `visibleFrom` |

「社内の備品貸出」は P1、「読書会の出欠」は P2、「品質検査の記録」は P4。
**業種名で引くと LLM は 4 つのサンプルの外に出られないが、形で引けば無限に適用できる。**

各テンプレートには**罠を併記する** —「`gated` を忘れると生徒が満点を取る」「`immutable` が無いと
議長が票を書き換えられる」。テンプレートの価値は完成品ではなくこの注記にある。

配布は既存の Discover レジストリ（`@mulmoclaude/core/collection/registry/server` の
`listRegistry` / `importRegistry`、公式は `receptron/mulmoclaude-collections`）に乗せられる。

### 汎用性を守る不変条件

> **テンプレートはエンジンを一切拡張しない。純粋なデータである。**
> **テンプレートを書くのにコード変更が要ったなら、それは宣言言語の欠落であって
> テンプレートの問題ではない。**

これがテンプレートを「サンプル」に留め、システムを汎用に保つ唯一の防波堤。

---

## 宣言で表現できる範囲 — この構想の寿命を決める場所

> **注: セキュリティ面の結論は上の「HTML は生成物、スキーマが統治対象」で更新済み。**
> HTML はデータ層で守られた sandbox 内の生成物なので、自由に生成してよい。
> この節が扱うのは**残る方の問題** — 宣言で書けないことが増えると、
> スキーマが痩せて HTML に真実が移り、**レビュー対象が消える**という劣化。

宣言で書けない要求が増えると「LLM に HTML を書かせればいい」で済ませたくなり、そのとき
**HTML はスキーマの射影ではなくなる**（= 上の規律を破る）。そうなると git のスキーマを読んでも
アプリが何をするか分からず、「git で管理される React アプリ」に戻る。それはもう新しくない。

つまり守るべきは「HTML を書かせない」ことではなく、**「HTML に真実を移させない」**こと。
そのためには宣言で表現できる範囲を widen し続けるしかない。

**美容室シナリオはこの圧力を即座にかけてくる。** 「シフト − 承認済み予約 − 所要時間 = 空き枠」は
レコード単位の computed field（`deriveAll`）では書けない、複数レコードを跨ぐ計算だから。

**答えは schedule ビューを宣言的なビュー型として一級市民にすること:**

```json
"views": [{
  "type": "schedule",
  "resource": "stylists",
  "availability": "shifts",
  "busy": { "collection": "bookings", "when": "status == 'approved'" },
  "slot": { "durationFrom": "services.duration" },
  "submit": "bookings"
}]
```

「リソース × 時間 × 所要時間 × 予約」は業種を超えて繰り返し現れる（会議室、設備、面談、レンタル）。
1 つ作れば何度も効く。**この一手を打てるかどうかが「コードを書かずに」が本当かどうかを決める。**

**アンケートで同じ役割を果たすのが条件分岐（スキップロジック）** — 「Q3 が『はい』なら Q4 を出す」。
HTML に逃がすと元の木阿弥なので、**既存の `when`（`fieldBase`）を条件表示に使い**、
多段分岐が要るときも**完全なスクリプトではなく単純な式に限る**のが線。ここも「どこまで宣言で書けるか」の実験場になる。

方針:

- 宣言で表現できる範囲を意図的に広げ続ける（HTML に逃げる理由を減らす — ここが製品開発の中身）
- HTML ビューは別扱い（publish 時に警告、レビュー必須、webview では sandbox iframe に隔離して
  Firestore ハンドルを渡さない）
- 少なくとも **HTML ビューを持つアプリは一覧で見分けがつく**ようにする

---

## D7 が漏れうる箇所（監視点）

1. **メール送信をホスト監視で実装しない** — Trigger Email 拡張の採用は好みではなく不変条件
2. **publish のペイロードが完結していること** — Web が必要とするもの（スキーマ、ビュー HTML、
   public 設定）が全部 Firestore/Hosting に載る。実行時にディスクを参照する経路が 1 本でも残ったら嘘になる
3. **ref を辿る computed field** — 予約の終了時刻は `service.duration` を参照する。
   remote-host 経路は ref キャッシュがないので諦めている（"formulas that dereference `ref` fields
   stay absent"）が、**webview では諦められない**。→ **View Bridge の親側が解決してから push する**
   ことで解決（ビューは解決済みの値を受け取る）。タダではないが、置き場所は決まった
4. **匿名トラフィックのコスト** — 公開側は既定で `onSnapshot` ではなく**キャッシュ付きの単発取得**。
   メンバー向け画面はライブでよい。**ただしシナリオ 3 はライブが必須**なので、`live: true` を
   宣言で切り替えられるようにする（既定は非ライブ）

---

## UI（前提: 種別は 1 つ、状態は隠せない）

**「別の種類のコレクション」ではなく「コレクションの、隠せない属性」。**

- **名詞は分けない** — コレクションはコレクション。バックエンド名（Firestore）を UI に出さない。
  軸は保存先ではなく**可視範囲**（「共有中 — 5 人」「このMacだけ」）
- **作成時は明示的な 2 択**。ドロップダウンの 4 番目にしない。既定を持たせない。
  **エージェント経由も同じ** — 「レストランのリスト作って」から共有が生まれてはいけない
- **バッジは消えない**。他人が所有するものは別セクション（削除できない・スキーマを変えられないという
  非対称があるので、同じ棚に並べると失敗の理由が分からなくなる）。
  未接続時に全操作が失敗する挙動の**エラーの先出し**にもなる
- **変換は一方向・確認あり**。「何が自分のマシンを離れるか」を名指しする。トグルにしない
- ヘッダーは 2 行:

```text
共有中 — 5人（owner: satoshi、editor 2、viewer 2）              ← Firestore
定義 — github.com/receptron/salon @ a1b2c3d（2日前に publish）  ← git
```

下の行は **publish 忘れが一目で分かる**行でもある。

**スキルとドキュメントだけは分ける** — 共有のセットアップ手順（ログイン、招待、ロール、
オフラインの意味）は本当に別物。概念は 1 つ、手順書は別。

---

## サンプルのテーブル設計とスキーマ

**LLM 向けのテンプレート実体。** 4 つのシナリオを実際のスキーマとして書き下ろす。

> **この節が示すのは authored な形**（リポジトリにコミットする `app.json` と `schema.json`）で、
> Firestore の `apps/{aid}` は publish が導出した別のドキュメント。
> 対応は「authored な `app.json` と published な `apps/{aid}` は別物」の変換表を参照。
> 特に `window` の端点は **ISO で書き、publish が epoch millis に落とす**。
>
> この節の JSON ブロックは**すべて単体で valid な JSON**（機械検証済み）。
> 上の各節にある JSON は説明用の**断片**（キーだけを抜き出したもの）なので、そのままでは
> パースできない。テンプレートとして起こすのはこの節。

### 語彙の区別（重要）

サンプルは**既存の語彙**と**この計画が提案する語彙**を混ぜている。LLM が存在しないキーを
学習しないよう、区別を明示する。

**既存のフィールド型**（`@mulmoclaude/core/collection` の `FieldSpecZ`、実在を確認済み）:

`string` `text` `markdown` `number` `money` `boolean` `toggle` `date` `datetime`
`enum` `ref` `email` `image` `file` `location` `table` `derived` `embed`
`backlinks` `rollup` `flag`

> **`status` というフィールド型は存在しない。** この一覧は当初 `status` を挙げていたが、
> `schemaZ.ts` の判別共用体に無い（実装順 5 で、テストのフィクスチャを書いていて判明）。
> 状態を持つフィールドは **`enum`** で書く。宣言してもエラーにはならず、
> **discovery がそのコレクションを黙って飛ばすだけ**なので、症状は「コレクションが出てこない」。
> なお `collections[cid].statusField` は別物で、**publish が出すアプリ設定のキー**として実在する。

`derived` `embed` `backlinks` `rollup` `toggle` `flag` は **computed**（レコードに書かれない）。

**既存のアクション種別**: `chat`（可視 LLM） / `agent`（隠しワーカー） / `mutate`（宣言的な書き込み）。

**既存の文法で間違えやすい点**（レビューで実際に間違えた。`schemaZ.ts` で確認済み）:

- **`icon` はコレクション必須**（`CollectionObjectZ`）。省略すると schema が通らない
- **`actions` は配列**（`z.array(ActionSpecZ)`）。オブジェクトマップではない。各要素に
  一意な `id` と `label` が要る（`actionBase`、`id` 重複は refine で拒否）
- **`mutate` アクションのゲートは `require`**、`when` ではない（`when` は `chat`/`agent` 側）。
  `require` は表示条件かつ**サーバー側の認可条件**でもある
- **フィールドの条件表示は既存の `when`**（`fieldBase`）。新しいキーを足す必要はない

**この計画が新規に提案するキー**（実装が要る。定義箇所を併記）:

| キー | 置き場所 | 定義 |
|---|---|---|
| `storage.type: "firestore"` | schema | D1 / D2。**`cid` は schema に持たせない** — `cid` は常に collection の slug（実装順 3 の決定 7） |
| `immutable` | schema（コレクション） | シナリオ 4 |
| `revealGated` | schema（`gated` の生成物） | シナリオ 3 |
| `peerVisibility` | schema（コレクション） | シナリオ 4 |
| `gated` | schema（コレクション） | シナリオ 3 |
| `views[].datasets` / `.actions` / `.live` | schema | View Bridge |
| `views[].type: "schedule"` | schema | 宣言の境界 |
| `actions.*.then.email` | schema | 宣言的な副作用 |
| `aggregate` | schema | シナリオ 2 / 3 / 4 |
| `aid` / `members` / `public` | `app.json` | D1 / 権限モデル |
| `public.submit[cid].*`（`createFields` / `selfUpdate` / `selfTransitions` / `idFrom` / `idField` / `gateOn` …） | `app.json` | 認証段階・シナリオ 2/3/4 |
| `session` | Firestore ドキュメント | シナリオ 3 |

> **`public.submit[cid].createFields` は、そのコレクションの `primaryKey` を含んではならない。**
> **共有レコードの同一性はドキュメント ID** であり、そこはルールが縛れる唯一の場所である
> （`idFrom` が投稿者の uid に固定する）。ルールは**フィールドの値**を縛れない —
> `validateOk` はキーの有無、`keyFieldsOk` は宣言された enum を見るだけで、
> `request.resource.data[primaryKey]` と書き込み先のパスを比較するものは無い。
> だから primaryKey を `createFields` に入れると、投稿者は自分に許されたドキュメント ID に
> 書きながら**他人のレコードの同一性を名乗れる**。
>
> **状態（2026-08-11）: この形は mulmoclaude #2868 でレビュー中で、まだ出荷されていない。**
> 公開済みの `@mulmoclaude/core` 3.7.0 は主キーを合成せず、publish の検査は逆
> （`createFields` に primaryKey を**要求**する）。#2868 がマージされるまでは、
> 下の記述は**これからそうなる形**として読むこと。
>
> firestore store は読み出し時に**ドキュメント ID から主キーを埋める**ので、投稿された値は
> 「ID と同じ（無意味）」か「捨てられる嘘」のどちらかにしかならない。値が捨てられる
> フォーム項目を publish するのは、無いより悪い（作者は投稿者が ID を選べると信じる）。
> **publish が拒否する（#2868 以降）。**
>
> **これは一度逆に書かれていた。** 当初は「含めなければならない」— 主キーの無いレコードは
> 全ての読み手に拒否されるから — としていた。症状の見立ては正しく、処方が誤っていた:
> 同一性は**ルールが固定できる ID** に属し、固定できないフィールドには属さない。

> **既存の custom view との関係**: `CollectionCustomView` は既に sandbox iframe +
> **capability トークン + `dataUrl`**（`__MC_VIEW.dataUrl`、`capabilities: ["read","write"]`）
> でビューにデータを渡している。**ビューが Firestore を触らない、という原則は既に実装済み。**
> View Bridge はその**ホスト非依存の後継** — 公開 webview にはホストの HTTP エンドポイントが
> 無いので、fetch ではなく親フレームからの push にする。`capabilities` が `datasets` / `actions`
> に対応する。**並行して別機構を作らないこと。**

---

### S1 — 美容室の予約（P1 予約パターン）

**テーブル設計**

```text
stylists  1 ──< shifts        美容師のシフト
stylists  1 ──< bookings      担当
services  1 ──< bookings      メニュー（所要時間の供給元）
```

`bookings.endAt` は `services.duration` を ref 越しに参照する `derived`。
**View Bridge の親側が ref を解決してから push する**（監視点 3）。

**`app.json`**

```json
{
  "aid": "app_salon_7f3a",
  "aidEnv": "MT_APP_SALON",
  "name": "Sakura Hair 予約",
  "owner": "<uid>",
  "members": { "owner@salon.jp": { "*": "owner" },
               "stylist-a@salon.jp": { "bookings": "editor", "shifts": "viewer", "services": "viewer" } },
  "collections": {
    "bookings": {
      "statusField": "status",
      "transitions": { "initial": ["pending"],
                       "pending": ["approved", "rejected", "cancelled"],
                       "approved": ["cancelled"],
                       "rejected": [], "cancelled": [] },
      "mail": { "toField": "customerEmail",
                "on": { "booking-approved": { "from": ["pending"], "to": "approved" },
                        "booking-rejected": { "from": ["pending"], "to": "rejected" } },
                "dataFields": ["customerName", "startAt"] }
    },
    "services": {}, "shifts": {}, "stylists": {}
  },
  "participantRead": [],
  "public": {
    "enabled": true,
    "read": ["services", "shifts", "stylists"],
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "emailField": "customerEmail",
        "idFrom": "auto",
        "finalize": false,
        "createFields": ["customerName","customerEmail","service","stylist","startAt","status"],
        "selfUpdate": { "pending":  ["customerName","startAt","stylist"],
                        "approved": ["customerName"] },
        "selfTransitions": { "pending": ["cancelled"], "approved": ["cancelled"] },
        "initialStatus": "pending",
        "validate": { "required": ["customerName", "customerEmail", "service", "startAt", "status"] },
        "window": { "until": "2026-12-31T23:59:59Z" }
      }
    }
  }
}
```

`finalize: false` = 客が「マイ予約」から変更できる。**`status` は `createFields` にあるが
`selfUpdate` には無い** — 作成時は `initialStatus` の検証のために必要だが、更新で触らせると
**客が自分の予約を `approved` にできてしまう**（権限昇格）。キャンセルは `selfTransitions` で
宣言された遷移としてのみ許す。

そして **`selfUpdate` は状態ごと**。`approved` の欄に `startAt` / `stylist` が無いのが要点で、
**承認後に客が枠を動かせない**（動かしたければキャンセルして取り直す）。平坦なリストだと、
承認済みの予約が黙って別の時間帯に移り、`schedule` ビューの busy 判定だけが更新される。

**`.claude/skills/services/schema.json`**

```json
{
  "slug": "services", "title": "メニュー", "icon": "content_cut",
  "storage": { "type": "firestore" },
  "primaryKey": "name",
  "fields": {
    "name":     { "type": "string", "label": "メニュー名", "primary": true, "required": true },
    "duration": { "type": "number", "label": "所要時間（分）", "required": true },
    "price":    { "type": "money",  "label": "料金", "currency": "JPY" }
  }
}
```

**`.claude/skills/stylists/schema.json`**

```json
{
  "slug": "stylists", "title": "スタッフ", "icon": "person",
  "storage": { "type": "firestore" },
  "primaryKey": "name",
  "fields": {
    "name":   { "type": "string", "label": "名前", "primary": true, "required": true },
    "photo":  { "type": "image",  "label": "写真" },
    "active": { "type": "boolean","label": "在籍中" }
  }
}
```

**`.claude/skills/shifts/schema.json`**

```json
{
  "slug": "shifts", "title": "シフト", "icon": "schedule",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": {
    "id":      { "type": "string",   "primary": true },
    "stylist": { "type": "ref",      "label": "担当", "collection": "stylists", "required": true },
    "date":    { "type": "date",     "label": "日付", "required": true },
    "startAt": { "type": "datetime", "label": "開始", "required": true },
    "endAt":   { "type": "datetime", "label": "終了", "required": true }
  }
}
```

**`.claude/skills/bookings/schema.json`**

```json
{
  "slug": "bookings", "title": "予約", "icon": "event",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": {
    "id":            { "type": "string",   "primary": true },
    "customerName":  { "type": "string",   "label": "お名前", "required": true },
    "customerEmail": { "type": "email",    "label": "メール", "required": true },
    "service":       { "type": "ref",      "label": "メニュー", "collection": "services", "required": true },
    "stylist":       { "type": "ref",      "label": "担当",     "collection": "stylists" },
    "startAt":       { "type": "datetime", "label": "開始時刻", "required": true },
    "endAt":         { "type": "derived",  "label": "終了時刻",
                       "expr": "startAt + minutes(service.duration)" },
    "status":        { "type": "enum",     "label": "状態",
                       "values": ["pending", "approved", "rejected", "cancelled"] }
  },
  "actions": [
    { "id": "approve", "kind": "mutate", "label": "承認する",
      "require": { "field": "status", "in": ["pending"] },
      "set":     { "status": "approved" },
      "then":    { "email": { "to": "{{customerEmail}}", "template": "booking-approved" } } },
    { "id": "reject", "kind": "mutate", "label": "お断りする",
      "require": { "field": "status", "in": ["pending"] },
      "set":     { "status": "rejected" },
      "then":    { "email": { "to": "{{customerEmail}}", "template": "booking-rejected" } } }
  ],
  "views": [{
    "id": "book", "type": "schedule", "label": "予約する", "live": false,
    "resource":     "stylists",
    "availability": "shifts",
    "busy":   { "collection": "bookings", "when": "status == 'approved'" },
    "slot":   { "durationFrom": "services.duration" },
    "submit": "bookings"
  }]
}
```

**罠**

- `services.price` を `public.read` に入れているので**料金は公開される**。非公開にしたいなら
  `gated` が要る（S3 参照）
- `then.email` を書くだけでは足りない。**`collections.bookings.mail` を publish しないと
  承認メールがルールに拒否される**（そして書かないと、書き手が任意の宛先に送れてしまう）
- `endAt` が `derived` なので**保存されない**。集計や衝突判定は毎回計算される
- 空き枠計算は `schedule` ビューが持つ。**ここを HTML に逃がすと宣言の意味が消える**

---

### S2 — Web アンケート（P2 収集パターン）

**テーブル設計**

```text
questions   質問（公開読み取り）
responses   回答（一人一回・書き切り・本人と owner のみ）
results     集計（aggregate が publish、公開読み取り）
```

**`app.json`（抜粋）**

```json
{
  "aid": "app_survey_2026q3",
  "collections": {
    "questions": {},
    "responses": { "peerVisibility": "hidden", "statusField": "status",
                   "submitOnly": true,
                   "transitions": { "initial": ["submitted"] } },
    "results": {}
  },
  "participantRead": [],
  "public": {
    "enabled": true,
    "read": ["questions", "results"],
    "submit": {
      "responses": {
        "auth": "verifiedEmail",
        "idFrom": "auth.uid",
        "finalize": true,
        "window": { "from": "2026-09-01T00:00:00Z", "until": "2026-09-30T23:59:59Z" },
        "createFields": ["q1","q2","q3","status"],
        "selfUpdate": {},
        "initialStatus": "submitted",
        "validate": { "required": ["q1", "status"],
                      "keyFields": [{ "field": "q1", "values": ["a", "b", "c"] },
                                    { "field": "q2", "values": ["1", "2", "3", "4", "5"] }] }
      }
    }
  }
}
```

**この S2 は `audience` を宣言していない** — ログインした人なら誰でも 1 回答えられる、
という「リンクを知っている人向け」のアンケート。`idFrom: "auth.uid"` が一人一回を担保する。

**名指しの相手だけに配るなら `audience: "participant"` を足し、`members` を宣言する。**
`members` が無いまま `audience` だけ書くと `listed()` が偽になり、**投稿が全部拒否される**
（fail closed で、原因が「権限エラー」ではなく「なぜか送れない」として現れる）:

```json
{
  "members": { "owner@x.jp": { "*": "owner" }, "member-1@x.jp": { "*": "participant" } }
}
```

**`memberEmails` は書かない。** `members` からの純粋な導出で、`members` を書く経路
（publish と招待 UI）が必ず一緒に生成する。ルールの `membersConsistent()` は
**ずれた状態を書き込めなくするための不変条件**であって、人に二重管理を課すためのものではない。

**`questions/schema.json`**

```json
{
  "slug": "questions", "title": "設問", "icon": "help",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "fields": {
    "id":      { "type": "string", "label": "ID", "primary": true },
    "order":   { "type": "number", "label": "表示順" },
    "text":    { "type": "text",   "label": "設問文", "required": true },
    "kind":    { "type": "enum",   "label": "形式", "values": ["single","multi","scale","free"] },
    "choices": { "type": "table",  "label": "選択肢",
                 "fields": { "value": { "type": "string" }, "label": { "type": "string" } } },
    "required":{ "type": "boolean","label": "必須" }
  }
}
```

**`responses/schema.json`**

```json
{
  "slug": "responses", "title": "回答", "icon": "how_to_reg",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "peerVisibility": "hidden",
  "fields": {
    "id":     { "type": "string", "label": "ID", "primary": true },
    "q1":     { "type": "enum",   "label": "Q1", "values": ["a","b","c"], "required": true },
    "q2":     { "type": "enum",   "label": "Q2（1-5）", "values": ["1","2","3","4","5"] },
    "q3":     { "type": "text",   "label": "Q3 自由記述",
                "when": { "field": "q1", "in": ["a"] } },
    "status": { "type": "enum", "values": ["submitted"] }
  },
  "aggregate": {
    "from": "responses", "publish": "results",
    "by": ["q1", "q2"], "visibleFrom": "revealed", "visibility": "public"
  }
}
```

**罠**

- `idFrom: "auth.uid"` を**書き忘れると一人が何回でも回答できる**（リンターが検出）
- `selfUpdate: {}` は `finalize: true` と重複するが、**明示しておくと意図が読める**
- **`q2` を `number` ではなく `enum` にしてある。** `aggregate.by` に載るフィールドは
  ルールが値を検査できなければならず（`validate.keyFields`）、検査できるのは
  有限の値集合だけ。**尺度回答を自由な数値にすると、直接クライアントが
  `q2: "not-a-score"` を投げて公開された集計を壊せる**
- `finalize: true` と `window` は**両方**要る。`window` だけだと締切前に何度でも上書きできる
- **「一人一回」と「主催者に対して匿名」は両立しない**（サーバーが要る。範囲外）

---

### S3 — オンライン授業の演習（P3 ライブ授業パターン）

**テーブル設計 — 分割が要点**

```text
questions   問題文 + 3択          public read      ← 正解を入れてはいけない
answerKey   正解 + 解説           revealed のみ    ← gated が生成する
responses   生徒の回答            本人 + 先生のみ
stats       正答率                aggregate が publish
session     現在の問題とフェーズ  参加者は read のみ
```

**`app.json`（抜粋）**

```json
{
  "aid": "app_class_algebra",
  "members": { "teacher@school.jp": { "*": "owner" },
               "student-1@school.jp": { "*": "participant" } },
  "collections": { "questions": {}, "answerKey": { "revealGated": true, "gatedFrom": "questions", "revealBy": "revealed" },
                   "responses": { "peerVisibility": "hidden", "immutable": true,
                                  "statusField": "status", "submitOnly": true,
                                  "transitions": { "initial": ["answered"] } },
                   "stats": {} },
  "participantRead": ["questions", "stats"],
  "public": {
    "enabled": false,
    "read": [],
    "submit": {
      "responses": {
        "auth": "verifiedEmail", "audience": "participant",
        "idFrom": "auth.uid+field", "idField": "questionId",
        "finalize": true,
        "createFields": ["questionId","choice","status"],
        "selfUpdate": {},
        "initialStatus": "answered",
        "validate": { "required": ["questionId", "choice", "status"],
                      "keyFields": [{ "field": "choice", "values": ["A", "B", "C"] }] },
        "gateOn": { "phase": "answering", "match": "questionId" }
      }
    }
  }
}
```

`gateOn` = create 条件に `session.current == questionId && session.phase == "answering"` を課す。
**締切後の回答＝カンニングがルールで不可能になる。**

`idFrom` は**有限の enum**。`"auth.uid+field"` + `idField` で複合 ID
（`{uid}_{questionId}`）になり、**問題ごとに一人一回**が成立する。`"auth.uid"` だけだと
全問で 1 ドキュメントしか作れない。

**`questions/schema.json`**

```json
{
  "slug": "questions", "title": "設問", "icon": "quiz",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "gated": { "fields": ["correctChoice", "explanation"], "revealBy": "revealed" },
  "fields": {
    "id":            { "type": "string", "label": "ID", "primary": true },
    "order":         { "type": "number", "label": "表示順" },
    "text":          { "type": "text",   "label": "問題文", "required": true },
    "choiceA":       { "type": "string", "label": "A", "required": true },
    "choiceB":       { "type": "string", "label": "B", "required": true },
    "choiceC":       { "type": "string", "label": "C", "required": true },
    "correctChoice": { "type": "enum",   "label": "正解", "values": ["A","B","C"], "required": true },
    "explanation":   { "type": "markdown", "label": "解説" },
    "revealed":      { "type": "boolean", "label": "公開済み" }
  }
}
```

**`gated` が生成する実体**（エージェントが手で書くのではない）:

```text
apps/{aid}/collections/questions/items/{id}   id, order, text, choiceA..C, revealed
apps/{aid}/collections/answerKey/items/{id}   correctChoice, explanation
```

生成されるコレクション設定（`app.collections.answerKey`、publish 時に載る）:

```json
{ "revealGated": true, "gatedFrom": "questions", "revealBy": "revealed" }
```

**`answerKey` のドキュメント自身は `revealed` を持たない。** だから read ルールは
**親（`questions`）の同じ id を `get()` して**フラグを見る。従属側のフラグを見にいくと
永久に false のままで、正解が明かされても生徒に届かない（初稿の欠陥）。
`get()` が 1 回増えるが、問題数ぶんしか呼ばれない。

**`responses/schema.json`**

```json
{
  "slug": "responses", "title": "回答", "icon": "how_to_reg",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "peerVisibility": "hidden",
  "immutable": true,
  "fields": {
    "id":         { "type": "string", "label": "ID", "primary": true },
    "questionId": { "type": "ref",    "collection": "questions", "required": true },
    "choice":     { "type": "enum",   "values": ["A","B","C"], "required": true },
    "correct":    { "type": "derived", "expr": "choice == questionId.correctChoice" },
    "status":     { "type": "enum", "values": ["answered"] }
  },
  "aggregate": {
    "from": "responses", "publish": "stats",
    "by": ["questionId", "choice"],
    "on": "session.phase == 'revealed'",
    "visibleFrom": "revealed", "visibility": "participant"
  },
  "views": [{
    "id": "quiz", "type": "html", "file": "views/quiz.html",
    "datasets": ["questions", "stats", "session"],
    "actions": ["answer"], "live": true
  }]
}
```

**`session` ドキュメント**（レコードではなくランタイム状態）

```json
{ "current": "q3", "phase": "answering", "startedAt": "2026-09-10T01:00:00Z" }
```

**罠**

- **`gated` を忘れると生徒は全問正解できる。** 動くしテストも通る。**授業で満点が出るまで
  誰も気づかない。** これがリンター最優先の項目である理由
- `correct` は `derived` なので `answerKey` が読めない生徒側では**解決されない** —
  それが正しい（明かす前に正誤が分かってはいけない）
- `immutable: true` により、生徒も先生も回答を書き換えられない
- **生徒は `participant` なので `responses` の全件は読めない。** ルールの `reader()` は
  owner/editor/viewer だけを含み、`participant` は「自分の行」までしか届かない
  （名簿に載っていることと、データを読めることは別）

---

### S4 — 議会の投票（P4 記録パターン）

**テーブル設計**

```text
topics    議題                    参加者 read
votes     投票（記名・不変）      参加者が全件 read ← peerVisibility: public
session    現在の議題とフェーズ   参加者 read のみ
```

**集計コレクションが無いのが要点。** `peerVisibility: "public"` なので
**各クライアントが自分で数える**。集計を担う信頼された計算機が要らない。

**`app.json`（抜粋）**

```json
{
  "aid": "app_council_2026",
  "members": { "chair@council.jp": { "*": "owner", "votes": "participant" },
               "member-01@council.jp": { "*": "participant" } },
  "collections": { "topics": { "immutable": true },
                   "votes": { "immutable": true, "peerVisibility": "public",
                              "statusField": "status", "submitOnly": true,
                              "transitions": { "initial": ["cast"] } } },
  "participantRead": ["topics"],
  "public": {
    "enabled": false,
    "read": [],
    "submit": {
      "votes": {
        "auth": "verifiedEmail", "audience": "participant",
        "emailField": "voter",
        "idFrom": "auth.uid+field", "idField": "topicId",
        "finalize": true,
        "createFields": ["topicId","voter","choice","status"],
        "selfUpdate": {},
        "initialStatus": "cast",
        "validate": { "required": ["topicId", "voter", "choice", "status"],
                      "keyFields": [{ "field": "choice", "values": ["yes", "no", "abstain"] }] },
        "gateOn": { "phase": "voting", "match": "topicId" }
      }
    }
  }
}
```

**`topics/schema.json`**

```json
{
  "slug": "topics", "title": "議題", "icon": "gavel",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "immutable": true,
  "fields": {
    "id":    { "type": "string",   "label": "ID", "primary": true },
    "order": { "type": "number",   "label": "表示順" },
    "title": { "type": "string",   "label": "議題", "required": true },
    "body":  { "type": "markdown", "label": "議案本文" },
    "closedAt": { "type": "datetime", "label": "採決時刻" }
  }
}
```

**`votes/schema.json`**

```json
{
  "slug": "votes", "title": "投票", "icon": "ballot",
  "storage": { "type": "firestore" },
  "primaryKey": "id",
  "immutable": true,
  "peerVisibility": "public",
  "fields": {
    "id":      { "type": "string", "label": "ID", "primary": true },
    "topicId": { "type": "ref",    "label": "議題", "collection": "topics", "required": true },
    "voter":   { "type": "email",  "label": "議員", "required": true },
    "choice":  { "type": "enum",   "label": "賛否", "values": ["yes","no","abstain"], "required": true },
    "status":  { "type": "enum", "label": "状態", "values": ["cast"] }
  },
  "aggregate": {
    "from": "votes", "by": ["topicId", "choice"],
    "visibleFrom": "during", "visibility": "participant"
  },
  "views": [{
    "id": "floor", "type": "html", "file": "views/floor.html",
    "datasets": ["topics", "votes", "session"],
    "actions": ["cast"], "live": true
  }]
}
```

`aggregate` に `publish` が**無い**のは意図的 — 全件読めるので各クライアントが計算する。

**`session` ドキュメント**

```json
{ "current": "t7", "phase": "voting" }
```

**罠**

- **`immutable` が無いと議長が票を書き換えられる。** 投票システムとして失格
- `peerVisibility: "public"` かつ `auth: "none"` は**匿名の第三者に全票を晒す**（リンターが検出）
- 定足数を出すには**投票していない参加者**を数える必要がある。`members` のうち
  `participant` の数はアプリドキュメントから取れる
- **無記名投票は範囲外**（サーバーが要る）
- `peerVisibility: "public"` は `listed(aid)`（名簿にいる全員）に全件読みを許す。
  **participant が全件を読める唯一の経路**であり、記名投票では意図どおり
- **`voter` は `emailField` で認証済み本人に固定する。** これが無いと `voter` は
  クライアントが自由に書ける文字列で、議員 A が**議員 B の名前で投票**できてしまう。
  `immutable` なので誤帰属は永久に残り、`peerVisibility: "public"` なので
  それが公式の記録として全員に見える。**記名投票の「記名」が申告制では意味がない**
- 議員のメールアドレスが議員同士に見えることになる。議会の記名投票としては妥当だが、
  避けたいなら `voter` を持たせず**投票の id（`{uid}_{topicId}`）を身元とし**、
  uid → 表示名は `apps/{aid}/config` に owner が公開名簿を置いて解決する

---

## 美容室シナリオの充足状況

| 要素 | 現設計 | 必要なもの |
|---|---|---|
| シフト入力（オーナー） | ○ | — |
| サービス別の所要時間 | ○ | computed field（ただし ref 解決、監視点 3） |
| 美容師ごとの権限 | 要追加 | コレクション別ロール（D1） |
| Web に公開 | 要追加 | `public.read`（ルール） |
| **誰でも申込み** | **要追加** | **制約付き create + `auth` の 3 段階 + App Check**（ルール） |
| 客が自分の予約を見る（段階 C） | **要追加** | 行レベル read（`emailField == email()`） |
| オーナー/美容師が承認 | ○ | mutate アクション |
| **承認メール** | **要追加** | **`then.email` + Trigger Email 拡張** |
| 二重予約 | ○ | **承認フローが競合解決そのもの**（両方 pending で入り、片方だけ承認） |
| **空き枠の表示** | **要追加** | **schedule ビュー**、さもなくば HTML 逃げ道 |

---

## Web アンケートシナリオの充足状況

| 要素 | 現設計 | 必要なもの |
|---|---|---|
| 質問の定義 | ○ | schema のフィールド型 |
| ログインして回答 | 要追加 | `auth: "verifiedEmail"`（段階 C） |
| **同じ人は 1 回だけ** | **要追加** | **`idFrom`**（ドキュメント ID を身元に） |
| 送信後は編集不可 | 要追加 | `finalize: true`（予約は `false` で本人が変更可） |
| 締切 | 要追加 | `window` + `request.time` |
| 他人の回答が見えない | ○ | 行レベル read |
| 自分の回答を確認 | 要追加 | 行レベル read（`itemId == uid`） |
| **結果の集計を公開** | **要追加** | **`aggregate` → `results` ドキュメント** |
| 条件分岐（スキップロジック） | ○（既存 `when`） | 多段分岐が要るなら式の拡張。**宣言の境界の実験場** |
| オーナーに対して匿名 | **不可** | サーバーが要る。**やらないと決める** |

---

## オンライン授業シナリオの充足状況

| 要素 | 現設計 | 必要なもの |
|---|---|---|
| 三択問題の定義 | ○ | schema のフィールド型 |
| 生徒がログインして回答 | ○（段階 C） | `auth: "verifiedEmail"` |
| 1 問 1 回答 | ○ | `idFrom`（生徒 uid + 問題 id の複合） |
| **正解が事前に漏れない** | **要追加** | **`gated`（コレクション分割 + `revealed`）** |
| **先生が 1 問ずつ進める** | **要追加** | **`session` ドキュメント** |
| 締切後の回答を弾く | 要追加 | create 条件に `gateOn` |
| **生徒の画面がライブ更新** | **要追加** | **`live: true`** |
| 正答率を見せる | 要追加 | `aggregate` + `on: session.phase == 'revealed'` |
| 生徒は自分の成績のみ | ○ | 行レベル read |
| 先生は全員の成績 | ○ | owner ロール |
| **クラスの生徒だけに限定** | **要追加** | **`participant` ロール** |

---

## 議会投票シナリオの充足状況

| 要素 | 現設計 | 必要なもの |
|---|---|---|
| トピックごとの賛否 | ○ | schema のフィールド型 |
| 議長がトピックを切り替える | ○（S3 で追加） | `session.current` |
| 議員のページが自動で進む | ○（S3 で追加） | `live: true` |
| 一人一票 | ○ | `idFrom`（uid + topicId の複合） |
| **戻って変えられない** | ○ | `finalize: true` + create 条件の `gateOn` |
| **リアルタイムのグラフ** | 要追加 | `aggregate.visibleFrom: "during"`。`peerVisibility: "public"` なら各クライアントが計算 |
| **記名（全員の票が見える）** | **要追加** | **`peerVisibility: "public"`** |
| **記録が改竄されない** | **要追加** | **`immutable: true`** |
| 議員だけが投票できる | ○（S3 で追加） | `participant` ロール |
| 無記名投票 | **不可** | サーバーが要る。**範囲外と明記** |

---

## ルールを凍結する前に決めること（チェックリスト）

ルールは `../mulmoserver` にあり cross-repo のデプロイが要る。**ここに書けないことは製品として
持てない。** 後から足したくなるものを今洗う:

> **[x] は「ルールに入り、emulator テストで固定された」という意味**（mulmoserver #155）。
> **残る [ ] は、ルールの外に実装が要るもの** — publish、リンター、webview —
> であって、ルールの形が未決定という意味ではない。

- [ ] **`appSlugs/{slug}` とそのルール** — D2b / D10。**まだ入っていない**（ルールの
      2 回目の cross-repo デプロイになる）:
      - `allow create` — 「その aid のオーナーであること」を `get(apps/{aid})` で確認し、
        **`request.resource.data.published == false` を要求**する（これが無いと、予約の
        時点で公開済みとして作れてしまい publish を素通りできる）。原子的な
        create-if-absent。**`apps/{aid}` を先に書いていること**が前提（D10）
      - **衝突時の再試行はクライアント側**。予約前の文書は読めない（`published == false`
        なので `allow read` に落ちる）ので、**空きを事前に調べることはできない**。
        `already exists` を受けたら次の候補（`-2`、`-3`…）で create し直す。同時 deploy が
        同じ候補を選ぶことがあるので、**成功した slug を `app.json` に書き戻して以降は
        再生成しない**
      - `allow update` — **オーナーのみ、かつ `aid` の付け替えを禁止**
        （`request.resource.data.aid == resource.data.aid`）。publish / unpublish が
        `published` を反転させるので、これが無いと既定の deny で両方が失敗する
      - `allow read: if resource.data.published == true` — 公開前は誰も辿れない
      - `allow delete: if false` — slug を消すと他人が拾える
- [x] アプリ階層（`apps/{aid}/collections/{cid}/items`）— D1
- [x] コレクション別ロール — D1
- [x] 公開読み取り（`public.read`）
- [x] 制約付き create（`public.submit`）と **`auth` の 3 段階**（A 完全匿名 / B 匿名認証 /
      C ログイン必須）— 段階を後から足すとルールのデプロイが要る
- [x] 申込者の行レベル read（段階 C の「マイ予約」／「自分の回答」）
- [x] `idFrom`（一人一回）・`finalize`（書き切り／本人による変更の可否）・`window`（期限）
- [x] `aggregate` の公開先（`results`）を誰が読めるか
- [x] `mail` キュー（宣言的な副作用）
- [x] フィールド単位の可視性 — **入れる。`gated` によるドキュメント分割**（シナリオ 3 が必須にした）
- [x] `participant` ロール（名指しされているが member ではない層）。
      **`listed()` と `reader()` を分離すること**
- [x] `createFields` / `selfUpdate`（**状態別**） / `selfTransitions` の分離
- [x] `collections[cid].transitions` を **writer にも** 効かせること
- [x] `idFrom` の有限 enum（`auto` / `auth.uid` / `auth.uid+field`）
- [x] `apps/{aid}/config`（名簿を含まない公開設定）
- [x] **アプリ本体（`apps/{aid}`）はクライアントから削除できない** — Firestore は
      カスケードしない。ルートを消すと子（`session` / `collections/*/items` / `mail`）が
      残り、それらのルールは全部 app ドキュメントを読むので、**メンバー判定を要する
      すべての読み書きが fail closed** する。**例外は `config/{docId}`**（`allow read: if true`）で、
      これは親が無くても読めたまま残る — つまり漏れるのは公開設定だけだが、**消せない**のは
      全部。
      **この状態は「永久」ではなく「復旧可能だが乗っ取り可能」**である: 誰かが
      `apps/{aid}` を作り直せば子はまた解決できるようになる。ところが `allow create` は
      「自分を owner と名乗ること」しか要求しないので、**空いた aid を先に拾った他人が
      孤児レコードごと owner になれる**。正規の復旧と乗っ取りが同じ操作であり、
      **先に実行した方が勝つ**というのが本当の危険。
      ルールは子の有無を見られないので条件付きにもできない → アプリの削除は**再帰削除**に属する。
      手順・権限・再試行・完了確認は下記
- [x] `auth` の有限 enum（`none` / `anonymous` / `verifiedEmail`）と `emailField` の切り離し
- [x] `publicOn()` をマスタースイッチにする + `participantRead`
- [x] `revealGated` は**親を `get()` する**形（従属ドキュメントにフラグは無い）
- [x] **任意キーの `in` ガード**（`public` / `collections` / `participantRead` /
      `audience` / `selfUpdate` / `selfTransitions` / `emailField` / `window` / `gateOn`）
- [x] `authed()` と `verified()` の分離（匿名認証が自分の行を読めること）
- [x] `roleIn()` の `'*'` フォールバックのガード（コレクション別ロールだけのメンバー）
- [x] `/mail` を `cid` の書き手にも開く
- [x] `get().data` の前に `exists()`、連結材料に `is string`
- [x] `list` クエリがルールの条件を写していること（親がクエリを組む）
- [x] **`/mail` が宣言（`then.email`）を再導出すること** — 宛先・テンプレート・自由文の禁止
- [x] **`validate` 射影**（`required` / `keyFields`）— **ルール側は完了**。宣言があれば
      create にも update にも効く（update を落としていた穴は #155 のレビューで発見）。
      publish がこの射影を出すこと、**`aggregate.by` ⊆ `keyFields` ∪ `gateOn.match` ∪
      `statusField`** をリンターが保証することは**まだ**（実装順 5 / 18）
- [x] **`submitOnly`** — 投稿経路を通っていないレコードを作らせない。ルールに入っている。
      **どのコレクションが宣言すべきかの不変条件は下記**（実装順 5 / 18 で publish が拒否する）
- [x] `/mail` の決定的 ID と `get() != getAfter()` による**この書き込みでの遷移**の要求
      （**クライアントはバッチで書く**）
- [x] `audience` は `== "participant"` の厳密一致
- [x] **authored → published の変換表**を publish が漏れなく実装すること
      （特に `window` の ISO → epoch millis。ルールは文字列を timestamp に変換しない）—
      **実装順 5 で完了**。変換は `publishProject.ts` に集約され、`rules_publish.ts` が
      publish の出力そのものをルールに流して固定している
- [x] `session` ドキュメント（主催者が駆動する状態機械）と、それを create 条件に使うこと
- [x] **`immutable`（owner にも触れない記録）** — ルールの形に関わる
- [x] `peerVisibility: "public"`（記名投票。参加者が全件読める）
- [ ] **生成 HTML の sandbox iframe 隔離 + View Bridge**（Firestore ハンドルを渡さない）—
      ルールでは守れないので webview 側の構造として最初から。
      **ブリッジは宣言されたデータセット名・アクション名のみを公開し、クエリ言語にしない**
- [ ] 時限アクセス / 「リンクを知っている人は閲覧可」— やるなら今
- [ ] Storage（添付）— `firestore.get()` で同じ members を参照。パスと制約を今決める

### アプリの削除（再帰削除）— 手順

ルールでは表現できないので、運用手順として決めておく。

```bash
firebase firestore:delete "apps/<aid>" --recursive --project <project>
```

- **実行者**: Firestore の書き込み権限を持つプロジェクト管理者。**アプリの owner ではない**
  — owner はクライアント資格情報しか持たず、ルールはこの操作を許可しない
- **順序**: 子から消える。**ルートを先に消してはいけない**（上のチェックリスト項目の理由）
- **再帰削除はアトミックではない。** 途中で失敗すると子が残る。その場合、`apps/<aid>` が
  まだ在れば通常状態のままなので、**同じコマンドを再実行すればよい**（冪等）。
  ルートだけが先に消えていた場合は、`apps/<aid>` を作り直してから再実行する
  — 乗っ取りと同じ操作なので、**空いている時間を作らないこと**が要点
- **完了確認**: `apps/<aid>` が存在しないこと、かつ
  `firebase firestore:delete "apps/<aid>" --recursive` を再実行して 0 件になること。
  「ルートが無い」だけでは孤児が残っていても区別がつかない
- Admin SDK で書くなら同じ性質（冪等・子が先・完了確認つき）を満たすこと

---

## 実装順

**基盤**

1. **`(aid, cid)` 同一性** — engine の `(root, slug)` INVARIANT を firestore バックエンドについて外す。
   一番深く、一番先。**これを 2 と 3 と同じ PR にしない**（レビューの性質が違う）
2. ~~**`apps/{aid}` ドキュメント + 静的ルール**~~ — **完了**（`../mulmoserver`
   `feat/shareable-collections-rules`、mulmoserver #155）。以下は当初の記述:
   `../mulmoserver` 側の PR が対になる。
   この時点でメンバーはオーナー 1 人。**emulator でルールのユニットテストを書く。**
   ルールの形に関わるものは**すべてここで入れる**（後から足すと cross-repo のデプロイになる）:
   `listed`/`reader` 分離、`participant`、`auth` の 3 段階、`publicOn`、`participantRead`、
   `createFields`/`selfUpdate`/`selfTransitions`、`transitions`、`idFrom` の enum、`gateOn`、
   `immutable`、`peerVisibility`、`revealGated`（親を `get()` する形）、`mail` キュー
3. **store を `(aid, cid)` で書き直す** — PR #2209 の中身がここに入る。
   **引き継ぎ用の切り出し: [`feat-shareable-collections-step3-store.md`](./feat-shareable-collections-step3-store.md)**
   （作業は `../mulmoclaude`。#2209 の再利用できる部分とプランと衝突する部分の地図つき）
4. ~~**discovery の 2 ソース化 + skill materialize**~~ — **落とした**（mulmoclaude #2867 を
   クローズ済み）。**使う人は Web から使い、自分の MulmoTerminal では扱わない**ので、
   購読する相手がいない。skill materialize も届け先が無い。
   **`memberEmails` は残る** — 引くのがホストから **Web クライアント**に変わるだけで、
   ルールの `membersConsistent()` も一致を要求し続ける
5. ~~**publish**（git → Firestore、記名 + 事前検証 + 前版保持）~~ — **完了**
   （mulmoclaude #2860 + mulmoserver #156、`@mulmoclaude/core` 3.7.0）。
   起動は `manageCollection` の `publishApp`。**何が入り、この計画のどこが間違っていたかは
   [`feat-shareable-collections-step5-publish.md`](./feat-shareable-collections-step5-publish.md)
   の「着手した結果」**。残った穴は mulmoclaude #2866（同時 publish の版混在）。以下は当初の記述:
   **publish**（git → Firestore、記名 + 事前検証 + 前版保持）。
   **引き継ぎ用の切り出し: [`feat-shareable-collections-step5-publish.md`](./feat-shareable-collections-step5-publish.md)**
   （ルールが実際に読むフィールドの正解表、authored → published 変換表、publish が拒否する不変条件つき）。**`submitOnly` の不変条件を
   ここで拒否する**（「`audience` は投稿経路しか縛らない」参照）— リンターは作者の手元でしか
   走らないので、保証はこちらに置く
6. **onSnapshot watcher** — `CollectionStore.watch` に載せる。
   `hostRunner.ts:154-184` の実装から `docChanges()` の扱いを持ち込む
7. **worktreeEnv による aid の分岐** — D6
   - **7a. MulmoClaude を触る変更（2 本で打ち止め）— 完了**（2026-08-12、
     `@mulmoclaude/core` **3.10.0** が npm に公開済み）:
     - **mulmoclaude #2870**（マージ済み）— 能力の宣言と受け入れゲート、MC の
       Firestore バインド解除
     - **mulmoclaude #2871**（マージ済み）— ホストが deploy / publish を自前で回すのに
       要る投影（`projectDeploy` / `projectPublish` / `promoteSchema`）、`staging` と
       `appSlugs` の置き場所、そして **`manageCollection.publishApp` の削除**。
       削除は必須で、任意ではない（下記）。ホストが依存する export は
       `test_sharedHostSurface.ts` で固定した
     以下は当初の 7a の記述（#2870 のみを指していた）:
     1. `setSharedCollectionsSupport()` と `acceptStorageSchema` のゲート
     2. MC の Firestore バインド解除（`initFirestoreCollectionBinding` を落とす）

     **export の追加は要らなかった** — `validateCollectionRecords` も
     `discoverCollections` も `export *` で既に出ており、このリポジトリの
     `server/backends/collections.ts` が現に import している
   - **7b. MT の Firestore 接続** — `setFirestoreAccessor` を MT で呼び、
     **`setSharedCollectionsSupport(true)` を別に呼ぶ**（`configureCollectionHost` の
     フィールドではない。理由は D5)。**PR 済み・未マージ**（mulmoterminal #1632）
   - **7c. MT 独自ツール `manageSharedApp`** — `deploy` / `publish` / `unpublish` の 3 つ。
     書き込み経路が 2 本ある状態（core の `publishApp`）は #2871 のマージで解消済み。
     門番と射影は core の純粋関数を呼び、**順序（fail closed）と書き分けは MT が持つ**（D10）。
     ルール側は先行して済んでいる — `appSlugs`（`published` フラグ）と
     **`match /staging/{cid}`** は **mulmoserver #157 でマージし、2026-08-12 に本番へ
     deploy 済み**（mulmoserver に CI は無く、デプロイ状態はどのリポジトリにも記録されない
     ので、ここが唯一の記録）
   - **7d. `aid` の UUID 自動生成**（決定 2）— `app.json` を書くのは MT なので MT 側

**共有**

8. **招待 UI（email 追加）と viewer / participant ロール** — ここで初めて他人が入る。
   **招待は Web の `/staging/{aid}` への招待**であって、相手の MulmoTerminal には何も起きない
9. **mulmoserver に webview** — `@mulmoclaude/collection-plugin` を 3 つ目のホストに載せる。
   **先に作るのは `/staging/{aid}`**（D10）— サインインしてロールを引く管理側の入口。
   これが 8 の招待を意味あるものにし、12 より前に**実データでの動作確認**を可能にする
10. **スキーマの `.strict()` 化 または 生 JSON リンター** — どちらを取るか決める（上記参照）。
    **新キーを足す前**でないと、書いたキーが黙って消えたまま先に進む
11. **View Bridge**（`@mulmoclaude/core/view-bridge`、親側 + 依存ゼロの子側ライブラリ）—
    **HTML ビューを使うシナリオより前。** 後から入れると既存の HTML が全部書き直しになる

**シナリオを揃える**

12. **公開ページ（`/{slug}`）+ App Check** — `auth` の 3 段階を同時に。
    9 の `/staging/{aid}` とは**別の顔**で、`config/public` だけを読んで未サインインでも描ける（D10）
13. **`then.email` + Trigger Email 拡張**
14. **`schedule` ビュー** → **美容室シナリオが揃う**
15. **`idFrom` / `finalize` / `window` / `aggregate`**（UI と集計側）→ **アンケートシナリオが揃う**
16. **`gated` の分割生成 / `session` / `live` / `aggregate` の `on`** → **授業シナリオが揃う**
17. **`immutable` / `peerVisibility` / `aggregate.visibleFrom`** → **議会シナリオが揃う**

**仕上げ**

18. **スキーマリンター本体** — 10 で決めた土台の上に、検出表の項目を実装
19. **テンプレート 4 種（P1-P4）+ 罠の注記** — 純粋なデータとして。Discover レジストリに乗せる。
    実体は「サンプルのテーブル設計とスキーマ」の 4 セットをそのまま起こす
20. **editor ロール + Storage 添付 + エージェント seed アクションの remote-host チャネル接続**

> 12-17 は HTML ビューを使うので **11 より後**。ルールに関わるものは**すべて 2 に前倒し**して
> あるので、12-17 はホスト側の実装だけになる。

## 未解決の論点

- ~~**emulator テストに上の 4 パターンを含めること**~~ — **完了**。
  `test/rules/rules_roster.ts`（任意キー無しのアプリ / `'*'` を持たないメンバー）、
  `rules_scenarios.ts`（親の無い gated）、`rules_submit.ts`（status を消す書き込み）、
  `rules_scenarios.ts` の S3（editor が `session` を書く）で固定してある
- **スキーマの `.strict()` 化 か、生 JSON リンターか** — `schemaZ.ts` は未知キーを
  バリアントごとに黙って落とすので、新キーは実装が入るまでパースで消え、`mutate` に書いた
  `when` もエラーにならない。**新キーを足す前に決める**（実装順 10）
- ~~**ルールの `hasOnly` / 動的キー参照 / `roleIn` の三項演算**が仕様通り書けるか~~ — **検証済み**。
  3 つとも書ける。書けなかったのは**別のこと**で、そちらが本題だった（上「検証の状態」）:
  ルール関数は呼び出し箇所ごとにインライン展開され、**1 リクエストの評価上限は 1000 式**。
  補助関数の連鎖が深いと非自明な経路が全部そこに達し、症状は「権限エラー」ではなく
  `Unable to evaluate the expression…`。**次にルールへ条件を足すときは、正しさと同じだけ
  式数を見ること。** 目安は、app ドキュメントを 1 回だけ取得して引数で下へ渡す形を崩さないこと
- **Storage ルールから `firestore.get()`** でメンバー判定できるか — 仕様上可能のはずだが実機未確認
- **repo 権限と members のずれ**をどう見せるか（当面は members をヘッダーに常時出すだけ）
- **email の同一性**（変更・再利用）— 当面受容
- ~~**公開ページの URL 設計** — `/{aid}` か、人間可読な slug を別に持つか~~ — **決定（D10）**。
  **両方**で、別の顔を出す: `/{slug}` が公開ページ、`/staging/{aid}` が名簿の人の入口。
  名前は `staging` — その入口が読むドキュメント（`apps/{aid}/staging/{cid}`）と一致する
- **`then.email` のテンプレート**をどこに置くか（git のリポジトリ内 → publish、が自然か）
