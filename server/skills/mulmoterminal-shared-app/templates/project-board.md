# テンプレート: 名簿のある作業板（オーナーが配り、参加者が取る）

**いつ使うか** — 作業の一覧を**オーナーが管理し**、参加した人が空いているものを自分で取って
進めるもの。チームの ToDo、勉強会の準備係、イベントの当日タスク、翻訳の分担。

**名簿が要るかを最初に決めてください。** この板は参加した人が名前を一度登録し、以後は名簿から
引きます — 毎回打たせないし、「誰が参加しているか」が一覧になる。代わりに**参加の一手（名前の
登録）が最初に挟まります**。使い捨ての板でそれが重いなら、`names` を落として担当行に名前を
書かせる形にもできますが、名前の出所が 2 つになるので、そのときは名簿を**完全に**やめること。

**最初に利用者へ言うこと**が 3 つあります:

- **担当の付け替えはできません。** オーナーにできるのは**外して空きに戻す**ことまでで、
  「A さんから B さんへ」は本人が取り直す 2 手になります（下の「なぜ付け替えられないのか」）。
- **名前は自己申告**です。ルールが検証できるのは「サインインした本人であること」だけで、
  名乗った名前が本名かは誰も確かめません。
- **公開する = 名前と担当が世界に出ます。** URL を知っている人は全員、誰が何をやっているかを
  読めます。社内だけに見せたいなら下の「公開範囲を狭める」を読んでください。

---

## 中心にある考え方 — 身元の置き場所が 3 通り出てくる

このアプリは 1 つの板の中で、**「誰の行か」を 3 通りの方法で決めています**。混ぜて書くと
どれも動かなくなるので、最初に分けておきます。

| コレクション | 誰の行かの決め方 | なぜそれか |
|---|---|---|
| `names` | **ドキュメント id が uid そのもの**（`idFrom: "auth.uid"`） | 1 人 1 行を強制できる。2 度目の登録は「既に在る文書への create」になって拒否される |
| `assignments` | **`uidField` のフィールド**（`uid`） | id は**作業 id**に使い切っている（排他）ので、身元はフィールドに置くしかない |
| `tasks` | 誰の行でもない | オーナーだけが作る。参加者は読むだけ |

`assignments` が `emailField` ではなく `uidField` なのは、**行を公開するとその行の全フィールドが
公開される**からです（ルールはフィールドを隠せません・原則 5）。担当者が見える板を公開するなら、
`emailField` の板は名前と一緒にメールアドレスを配ることになり、`uidField` の板は配りません。
板に出す名前は `names` から引きます。

---

## app.json

```json
{
  "aid": "(init が書きます。手で触らないこと)",
  "name": "プロジェクトの作業板",
  "slug": "project-board",
  "protocol": "1.0.0",
  "members": {
    "owner@example.com": { "*": "owner" }
  },
  "collections": {
    "tasks": {
      "writerDelete": true
    },
    "names": {
      "submitOnly": true
    },
    "assignments": {
      "submitOnly": true,
      "statusField": "status",
      "transitions": { "initial": ["doing"], "doing": ["done"], "done": ["doing"] },
      "writerDelete": true
    }
  },
  "views": [
    { "id": "board", "audience": "public", "path": "views/board.html", "collections": ["tasks", "names", "assignments"] },
    { "id": "desk", "audience": "member", "path": "views/desk.html", "collections": ["tasks", "names", "assignments"] }
  ],
  "public": {
    "enabled": true,
    "read": ["tasks", "names", "assignments"],
    "submit": {
      "tasks": {
        "auth": "verifiedEmail",
        "createFields": ["title", "detail", "due"],
        "validate": { "required": ["title"] },
        "window": { "until": "2000-01-01T00:00:00Z" }
      },
      "names": {
        "auth": "verifiedEmail",
        "idFrom": "auth.uid",
        "createFields": ["name"],
        "validate": { "required": ["name"] }
      },
      "assignments": {
        "auth": "verifiedEmail",
        "uidField": "uid",
        "idFrom": "field",
        "idField": "taskId",
        "idIn": { "collection": "tasks" },
        "createFields": ["taskId", "uid", "status"],
        "initialStatus": "doing",
        "selfTransitions": { "doing": ["done"], "done": ["doing"] },
        "selfDelete": ["doing"]
      }
    }
  }
}
```

**`tasks` の submit 宣言は「オーナー専用のフォーム」です。** 窓が 2000 年で閉じているのは
書き間違いではありません。

ページの入力フォームは**どの audience でも `public.submit` の宣言から作られます** — `/m/` の
オーナー画面も例外ではないので、宣言が無いとオーナーはページから作業を足せません（残る道は
コレクションペイン）。一方ルールの `createWith` は、writer の分岐を公開の分岐と**独立に**
持っています:

```text
(isWriter(r) && !flagOn(c, "submitOnly"))     ← オーナー。窓を見ない
  || publicCreate(...)                        ← 誰でも。この中に inWindow がある
```

だから**窓を閉じたまま宣言を置くと、「フォームの型は在るが、送れるのはオーナーだけ」**になります。
mulmoserver の `rules_submit.ts` に「a WRITER creates through a closed window」として固定してあるので、
分岐が組み替えられたらそこが落ちます。

罠が 1 つ: この宣言があると `subOpen(tasks)` が真になるので、**あとから `selfTransitions` や
`selfDelete` を `tasks` に足すと、その瞬間から「送った本人」の権限として生きます**。窓が閉じている
限り誰も送れないので今は無害ですが、窓を開ける日には両方を読み直してください。

**`assignments` に `submitOnly: true` があるので、オーナーは他人の担当行を作れません。**
これは仕様です（下の「なぜ付け替えられないのか」）。オーナーが配る側になる設計にしたいなら、
`uidField` ではなく `assigneeField` の形 — [salon.md](./salon.md) — に切り替えます。

---

## .claude/skills/tasks/schema.json

```json
{
  "title": "作業",
  "icon": "checklist",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "title": { "type": "string", "label": "作業", "required": true },
    "detail": { "type": "text", "label": "内容" },
    "due": { "type": "date", "label": "期限" }
  }
}
```

主キーは**読める合成スラッグ**にしてください（`fix-login-bug`）。担当の行 id がこの id に
なるので、運用中に目で追えます。

## .claude/skills/names/schema.json

```json
{
  "title": "参加者",
  "icon": "badge",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "name": { "type": "string", "label": "板に出る名前", "required": true }
  }
}
```

**`id` は本人の uid です**（`idFrom: "auth.uid"`）。フィールドは名前 1 つだけ — アドレスも
uid も**書きません**。uid は id として既に在るので、フィールドに置くと同じ値が 2 箇所に載ります。

これが 1 人 1 行を成立させている仕掛けでもあります。2 度目の登録は既に在る文書への create に
なり、公開の経路は create しか許していないので拒否される。**名前の変更はできません** —
やらせたいなら `selfUpdate: { ... }` を足すことになりますが、`names` に `statusField` が無いと
`selfUpdate` は宣言できない（状態ごとの宣言だから）ので、状態を 1 つ持つ設計に変わります。

## .claude/skills/assignments/schema.json

```json
{
  "title": "担当",
  "icon": "assignment_ind",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "taskId": { "type": "string", "label": "作業", "required": true },
    "uid": { "type": "string", "label": "担当者の uid", "required": true },
    "status": { "type": "string", "label": "状態", "required": true }
  }
}
```

**`id` と `taskId` は同じ値です。** id は排他の道具（1 作業 1 担当）で、`taskId` は
`idFrom: "field"` がその id を組み立てるために読むフィールド。両方要ります。

---

## 誰が何を押せるか

| 操作 | 誰が | どう宣言されているか |
|---|---|---|
| 名前を登録する | **メールを確認済み**のサインイン（`auth: "verifiedEmail"`） | `public.submit.names`（id が uid なので 1 人 1 行） |
| 作業を取る | 同上。**ルールは登録の有無を見ません** — 名簿に行が在ることを確かめるのはページ | `public.submit.assignments`（id 衝突で先着 1 人） |
| 完了にする / 戻す | 取った本人 | `selfTransitions: { doing: ["done"], done: ["doing"] }` |
| 担当を降りる | 取った本人・`doing` のときだけ | `selfDelete: ["doing"]` |
| 他人の担当を外す | owner / editor | `collections.assignments.writerDelete` |
| 完了を取り消す（他人の） | owner / editor | `collections.assignments.transitions` |
| 作業を足す・消す | owner / editor | `public.submit.tasks`（閉じた窓）と `collections.tasks.writerDelete` |

**`done` からは降りられません**（`selfDelete` は `doing` のみ）。終わった記録を残すためで、
やり直すときは「未完了に戻す」を押してから降ります。

**「登録していないと取れない」はルールに書けません。** `assignments` の create が見るのは
サインインと宣言だけで、`names` に行が在るかは見ない。だから**それはページの約束**です。
厳密に縛りたいなら `idIn` のような参照はここには使えない — `idIn` が見るのは `idField` が
指す先で、身元ではありません。

**そしてその約束は、「登録欄を先に出す」では守れません。** ページが握っている「この人は
登録済みか」は 3 状態で、3 つ目が `viewer.mine` の来ない「分からない」です。分からないから
と通すと、uid だけを持つ担当行ができる — 板には `holderName` の既定値（「担当者」）が出る
だけなので、名前の無い担当が普通の担当と同じ顔で並び、**どこにもエラーが出ません**。実際に
公開済みのアプリ 2 本がそうなりました。`viewer.mine` が公開ページに届くようになったのは
mulmoserver の 2026-08-19 で、それ以前は全員がこの枝に落ちています。

**まず、`view.mine` に訊いてください**（下の `askHost`）。これが 3 つ目の状態を潰す本命です。

`view.mine` は合成 id（`auth.uid+field`）のためのもの、と読めますが、`idFrom: "auth.uid"` でも
使えます — その id は uid そのもので、`recordId` はレコードを見ないからです。**つまりキーは
答えに影響しません。** ただし空文字だけはブリッジが `invalid-lookup` として弾くので、何か
1 文字渡します。返るのは `{ known, found, record }` で、`record` は `viewer.mine` と同じ投影
なので、名前を画面に出すのにも足ります。

**訊くのは `onState` からで、クリックからではありません。** 押してから訊くと、その押下は
`await` を跨いでしまい、続く `submit` に gesture の印（`GESTURE_MARK`）が付きません。印で
書き込みを門番するホスト — `manageSharedApp` の `preview` — はそれを**書きません**
（`writeWithheld`）。先に解決しておけば、リロード後の 1 押し目がそのまま取る押下になります。

同じ理由で、**1 押しに 2 本の書き込みを詰めてはいけません。**「登録して、それから取る」を
1 押しに書くと、登録だけが書かれて取るのが黙って落ちます。`viewer.mine` も `lookup` も無い
ホストのためにその枝を残すなら、登録に 1 押し・取るのに 1 押しに分けてください。

**そして登録が成立したときだけ取らせてください。** 拒否には「既に登録済み」（id が uid なので
2 度目の create は必ず拒否される）と「一時的な失敗」が同じ顔（生の Firestore メッセージ）で
返ってきて、ページには見分けがつきません。通すと、名前の行が無いまま担当行だけができる —
塞ごうとしている当のものなので、止める側に倒します。

**ただし「無い」を訪問ぶんの事実にしないこと。** `found: false` はその時点の写しです。行は
あとから現れます（同じ人が別のタブで登録した、行はできたのに応答を落とした）。そしてそれは
「登録ボタンが重複拒否を受け取る」形で現れるので、その拒否を受けたら否定の答えを捨てて
訊き直させてください。抱えたままだと、`askHost` は「もう確定している」と判断して二度と訊かず、
その人はリロードするまで取れません。**ページが人にリロードを要求してよい場面ではありません。**

---

## views/board.html — 参加者が見る板

公開ページ。**画面はデータから導きます** — 送信の結果が決めるのは「何を言うか」だけで、
「どの画面を出すか」は常に `onState` が届けたものから引く。そうしておくとリロードしても
同じ画面が出ますし、別のタブで取られた作業も次の状態で消えます。

The colours below all come from one `--hue`, and **it is meant to be changed** — this one is
this template's, not your app's. The rules behind the sheet, and how to go further than these
fifteen lines, are in [design.md](./design.md).

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 295;                                    /* violet - a board that keeps a roster */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  section { margin: 0 0 16px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 18px; background: var(--fill); }
  h2 { margin: 0 0 10px; color: var(--muted); font-size: 13px; font-weight: 750; letter-spacing: .04em; }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input, textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  .task { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; padding: 11px 0; border-top: 1px solid var(--line); }
  .task.wanted { padding: 11px 13px; border-radius: 12px; background: oklch(96% .04 55); }
  .ask { flex: 1 1 100%; margin: 4px 0 0; color: oklch(40% .09 55); font-size: 13px; }
  .title { flex: 1 1 200px; font-weight: 780; }
  .title .note { margin-left: 8px; font-weight: 400; }
  .who { color: var(--muted); font-size: 13px; }
  .who.mine { color: var(--main); font-weight: 750; }
  .say { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
  .say.bad { color: oklch(48% .15 25); }
  .note, .empty { color: var(--muted); font-size: 12px; }
</style>

<h1>今週の作業</h1>
<section><h2>あなた</h2><div id="me"></div></section>
<section><h2>作業</h2><div id="list"><p class="empty">読み込み中…</p></div></section>
<p class="say" id="say" role="status"></p>

<script>
  (() => {
    const view = window.__MC_APP_VIEW;
    const meBox = document.getElementById("me");
    const list = document.getElementById("list");
    const say = document.getElementById("say");

    /** 唯一の描画元。onState 以外からここを書き換えない。 */
    let latest = null;
    /** 取り下げの確認だけは押した行を覚える必要がある。sandbox は confirm() を無視するので
     *  ページの中で訊くしかない。データではないので latest とは別に持つ。 */
    let arming = null;
    /** 登録を挟んだせいで押下が 2 回に割れた作業。**意図はデータではない**ので `latest` とは
     *  別に持ちます（`arming` と同じ）。1 押しでは書き込みは 1 回だけ（`ensureRegistered` の
     *  上の注）なので、登録した人は必ずもう一度押すことになる — その「もう一度」を、文言では
     *  なく押した行そのもので出すために覚えます。 */
    let wanted = null;

    /** 名前の欄まで巻き上げられた人を、押した作業まで戻します。**戻さないのが元の不具合です**：
     *  登録して名簿の行ができると `#me` が「として参加中です」に変わり、それが成功に見える。
     *  一方で「まだ引き受けていません」は `#say`（ページの末尾）に出るので画面の外にあり、
     *  引き受けたつもりで板を離れた人が出ました。 */
    const focusWanted = () => {
      if (wanted === null) return;
      // 行を数えて探す。属性セレクタを文字列で組むと、id に " が入った瞬間に壊れます — この板の
      // 作業 id はホストが作るので今は入りませんが、テンプレートは書き換えられて配られます。
      const row = [...list.children].find((node) => node.dataset && node.dataset.task === wanted);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "center" });
    };

    const el = (tag, text, cls) => {
      const node = document.createElement(tag);
      if (text !== undefined && text !== null) node.textContent = text;
      if (cls) node.className = cls;
      return node;
    };
    const button = (text, act, task) => {
      const node = el("button", text);
      node.type = "button";
      node.dataset.act = act;
      if (task) node.dataset.task = task;
      return node;
    };
    const tell = (text, bad) => {
      say.textContent = text;
      say.className = bad ? "say bad" : "say";
    };

    /** 送信の 3 つの結末。cancelled は失敗ではない（確認で「やめる」を押した人は何が起きたか
     *  知っている）ので、何も言わずに消す — 前の失敗を残すと、それがこの操作の答えに見える。 */
    const report = (res, okText, hint) => {
      if (res && res.ok) { tell(okText, false); return; }
      if (res && res.error === "cancelled") { tell("", false); return; }
      const reason = (res && res.error) || "unknown";
      tell(hint + "（" + reason + "）", true);
    };

    /** 「この人は登録済みか」の 3 状態。`viewer.mine` が答えればそれ、答えなければ `askHost` が
     *  確定させたもの、どちらも無ければ「分からない」。
     *
     *  **キーが無い = 誰も読んでいない、であって「未登録」ではありません。** そして 2 つ目を
     *  ここに通すのが大事です — `ensureRegistered` の中だけで見ていると、照会で確定したあとも
     *  画面は「登録済みかは確認できませんでした」と言い続け、名前も出ません。
     *
     *  **`settled` と `row` は別の格**です。`row === null` は「行が無い」という答えで、
     *  「まだ訊いていない」ではない。1 つの変数に畳むと、ホストが「無い」と答えた人に登録欄を
     *  出し続けることになります — この板が塞ごうとしている取り違えの、ちょうど裏返しです。 */
    /** 書き込みが 1 本、外に出ているあいだ。
     *
     *  **押下を落とすのは、ここが `await` を跨ぐからです。** 未確定のホストでは 1 押し目が
     *  `names` を出したまま戻ってこない — その間の 2 押し目は `settled` をまだ `false` と読み、
     *  同じ登録をもう一度出します。危険ではありません（担当行は出ない）が、2 本目は必ず重複
     *  拒否になるので、登録できた人が「登録できませんでした」を読むことになります。
     *
     *  `arming` と違ってデータではないので、`render()` は見ません。 */
    let working = false;

    /** 照会の世代。**古い答えを捨てるため**で、`settled` を見るだけでは足りません — 拒否を
     *  受けて否定のキャッシュを捨てたその瞬間、それより前に出ていた照会が「行は無い」を持って
     *  戻ってきて、捨てたばかりのものを書き戻します。捨てた側が新しいので、世代で無効にします。 */
    /** 届いた状態の通し番号と、手元の答えを入れたときのそれ。
     *
     *  **どちらが新しいかを決めるためだけ**にあります。`viewer.mine.names` が `[]` のまま登録が
     *  成功した直後、投影を先に見ると「行は無い」と読んで、登録できた人の押下を断ってしまう —
     *  ホストが次の状態を送るまで。かといって手元の答えを恒久的に上に置くと、オーナーが名簿の
     *  行を消したことが二度と届かず、名前の行が無いまま担当行ができます（この板が塞いでいる
     *  当のもの）。だから**後に入ったほうが勝つ**にします。 */
    let states = 0;
    let settledAt = -1;

    let asked = 0;

    let settled = false;
    let resolved = null;
    let asking = false;

    const registration = () => {
      const mine = latest.viewer.mine;
      const projected = mine && Array.isArray(mine.names);
      if (settled && settledAt >= states) return { known: true, row: resolved };
      if (projected) return { known: true, row: mine.names[0] || null };
      if (settled) return { known: true, row: resolved };
      return { known: false, row: null };
    };

    /** `viewer.mine` が答えないときに、**ホストへ直接訊きます**。
     *
     *  `idFrom: "auth.uid"` の id は uid そのもので、`recordId` はレコードを見ません — つまり
     *  この照会に**キーは要りません**。ただし空文字だけはブリッジが `invalid-lookup` として弾く
     *  ので、何か 1 文字渡します。答えない runtime や、`lookup` を配線していないホスト
     *  （`manageSharedApp` の `preview`）は `known: false` を返すので、**確定したときだけ**覚えます。
     *
     *  クリックではなく `onState` から訊くのが要点です。押してから訊くと、その押下は `await` を
     *  跨いでしまい、gesture の印が付かない `submit` しか出せなくなります。ここで先に解決して
     *  おけば、リロード後の 1 押し目がそのまま取る押下になります。 */
    const askHost = async () => {
      if (asking || settled || typeof view.mine !== "function") return;
      asking = true;
      const ticket = asked;
      try {
        const answer = await view.mine("names", "-");
        // **待っている間に確定したものが勝ちます。** この照会はそれより前に出た問いで、戻って
        // きたときには答えが古い。登録が先に済んでいたのに `found: false` で上書きすると、その
        // 訪問のあいだ二度と取れなくなります — 登録し直しても重複拒否が返るだけで、直りません。
        if (settled || ticket !== asked) return;
        // `found: false` も答えです。`known: false`（誰も読んでいない）だけが「分からない」。
        // 行そのものを覚えるのは、`lookup` が `viewer.mine` と同じ投影を返すからで、名前を
        // 画面に出すのにそれで足ります。
        if (answer && answer.known === true) {
          settled = true;
          settledAt = states;
          resolved = answer.found === true ? answer.record || {} : null;
          render();
        }
      } finally {
        // 追い越されていたら、`asking` は新しい走者のものです。
        if (ticket === asked) asking = false;
      }
    };

    /** 否定の答えを捨てて、訊き直させます。飛んでいる照会は世代で無効にします — **取りはしません**。
     *  拒否は「既に在る」の証拠になり得るだけで、取ってよい根拠にはなりません。 */
    const forget = () => {
      settled = false;
      resolved = null;
      asked += 1;
      asking = false;
      void askHost();
    };


    /** 「名前を登録していない人が作業だけ取る」を塞ぐ唯一の関門。ルールは `names` に行が
     *  在るかを見ない — 宣言に書けない（上の「誰が何を押せるか」）ので、ここが最後です。
     *
     *  **1 回の押下で書き込みは 1 回だけ**です。`await` を挟んだ先の `submit` はクリックの
     *  dispatch が終わったあとに出るので gesture の印が付かず、印で書き込みを門番するホスト
     *  — `manageSharedApp` の `preview` — はそれを**書きません**。「登録して、それから取る」を
     *  1 押しに詰め込むと、登録だけが書かれて取るのが落ちる。
     *
     *  最後の枝（何も確定していないホスト）だけが 2 押しになります。`viewer.mine` も `lookup` も
     *  無いホストで、そこでは既に登録済みの人も一度は拒否されます — が、書き込みを門番している
     *  ホストはまさにそれで、**そこでは何も書かれません**。書くホストは 2 つとも `lookup` を
     *  配線しているので、`askHost` が先に答えます。
     *
     *  そして**登録が成立したときだけ**取らせます。拒否には「既に登録済み」と「一時的な失敗」が
     *  同じ顔（生の Firestore メッセージ）で返ってきて、ページには見分けられない — 通すと、名前の
     *  行が無いまま担当行だけができます。塞ごうとしている当のものなので、止める側に倒します。 */
    const ensureRegistered = async () => {
      const reg = registration();
      const input = document.getElementById("who");
      /** 断るときは、**押した人が見ている場所で**断ります。
       *
       *  `#say` はページの末尾にあります。一覧の途中のボタンを押した人には、そこに出た一行は
       *  画面の外です — 実際、公開したボードで「押しても何も起こらない」と報告されました。
       *  書き込みは正しく止まっていて、止まったことだけが誰にも見えていなかった。
       *
       *  なので登録欄まで運びます。`focus()` はブラウザなら勝手に巻き上げますが、それに任せず
       *  `scrollIntoView` も呼びます（jsdom には無いので、在るときだけ）。ページが名前の欄まで
       *  跳ぶこと自体が、文言より先に伝わる答えです。 */
      const refuse = () => {
        tell("先に名前を登録してください。", true);
        if (input) {
          if (input.scrollIntoView) input.scrollIntoView({ block: "center" });
          input.focus();
        }
        return false;
      };
      if (reg.known) return reg.row !== null ? true : refuse();
      const name = input ? input.value.trim() : "";
      if (name === "") return refuse();
      const res = await view.submit("names", { name });
      // 確認で「やめる」を押した人は、取るのもやめています。
      if (res && res.error === "cancelled") { tell("", false); return false; }
      // 同じ理由で訊き直させます（この枝では `settled` はまだ false なので、捨てるものは無い）。
      if (!res || !res.ok) {
        forget();
        tell("登録できませんでした（" + ((res && res.error) || "unknown") + "）。", true);
        return false;
      }
      settled = true;
      settledAt = states;
      resolved = { name };
      tell("登録しました。もう一度「これをやります」を押すと引き受けます。", false);
      return false;
    };

    /** 自分が持っている作業 id。担当の行 id は作業 id そのものなので、これで足ります
     *  （uid は viewer.mine から落ちているので、突き合わせには使えません）。 */
    const myTaskIds = () => {
      const mine = latest.viewer.mine;
      const rows = mine && Array.isArray(mine.assignments) ? mine.assignments : [];
      return new Set(rows.map((row) => row.id));
    };

    const drawMe = () => {
      const reg = registration();
      if (reg.row) {
        meBox.replaceChildren(el("div", "「" + String(reg.row.name || "") + "」として参加中です。"));
        return;
      }
      const note = reg.known ? "登録すると作業を取れます。" : "登録済みかは確認できませんでした。登録済みなら、押しても新しくは作られません。";
      // **出ているフォームは描き直さない。** `replaceChildren` は `#who` を作り直すので、焦点も
      // 入力途中の名前も消えます — 断ったその瞬間に名前の欄へ運ぶのが台無しになり、書き込みが
      // 失敗して訊き直させる枝では、打ってあった名前ごと消えて二度目が空で出ます。
      // 文言だけは追いつかせること。三状態の答えは後から来るので、`known` は false から true に
      // 変わります — 入力を作り直さずに、その一行だけ書き替えます。
      const already = meBox.querySelector("p.note");
      if (already) { already.textContent = note; return; }
      const label = el("label", "板に出る名前 ");
      const input = el("input");
      input.type = "text";
      input.id = "who";
      input.maxLength = 40;
      label.append(input);
      meBox.replaceChildren(label, button("この名前で参加する", "register"), el("p", note, "note"));
    };

    const holderName = (uid) => {
      const row = (latest.data.names || []).find((entry) => entry.id === uid);
      // 「登録していない人」と断定しないこと。名簿を `public.read` から外した板では
      // この分岐に全員が落ちるので、全員を未登録に見せることになります。
      return row && row.name ? String(row.name) : "担当者";
    };

    const actions = (task, held, isMine) => {
      const box = el("div");
      // disabled にしない。未登録かどうかは押したときに解決する（`ensureRegistered`）— 「分から
      // ない」ときに押せないボタンを描くと、登録済みの人から操作を取り上げることになる。
      if (!held) {
        box.append(button("これをやります", "take", task.id));
        return box;
      }
      if (!isMine) return box;
      if (held.status === "done") {
        box.append(button("未完了に戻す", "reopen", task.id));
        return box;
      }
      box.append(button("完了にする", "finish", task.id));
      if (arming === task.id) box.append(button("本当に外す", "drop", task.id), button("やめる", "unarm"));
      else box.append(button("アサインを外す", "arm", task.id));
      return box;
    };

    const render = () => {
      if (latest === null) return;
      drawMe();
      const tasks = latest.data.tasks || [];
      const held = new Map((latest.data.assignments || []).map((row) => [row.id, row]));
      const mine = myTaskIds();
      if (tasks.length === 0) {
        list.replaceChildren(el("p", "まだ作業がありません。オーナーが追加します。", "empty"));
        return;
      }
      list.replaceChildren(...tasks
        .slice()
        .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")))
        .map((task) => {
          const claim = held.get(task.id) || null;
          const isMine = mine.has(task.id);
          const row = el("div", null, "task");
          row.dataset.task = task.id;
          const title = el("div", null, "title");
          title.append(el("b", String(task.title || task.id)));
          // 期限と内容を並べ替えにしか使わない，では足りません。オーナーが入れた指示が
          // 参加者に見えない板は、取った人が何をすればいいか分からない板です。
          const bits = [task.detail, task.due ? "期限 " + task.due : ""].filter((bit) => bit);
          if (bits.length > 0) title.append(el("span", bits.join(" ・ "), "note"));
          row.append(title);
          row.append(el("span", claim ? (isMine ? "あなた" : holderName(claim.uid)) + (claim.status === "done" ? " が完了" : " が作業中") : "空き",
            isMine ? "who mine" : "who"));
          row.append(actions(task, claim, isMine));
          if (wanted === task.id) {
            // 押した人が見ている場所で、次の一手を出します。**取られていたら言うこと** —
            // 登録している間に空きでなくなるのは普通に起きるので、そこで「もう一度押せば
            // 引き受けます」と言うと、押しても取れないボタンを案内することになります。
            // `classList` で足すこと。`className` に書くと、行が持っている別の class を落とします
            // — この板は持っていませんが、`done` を付けて配った派生が実際にあります。
            row.classList.add("wanted");
            row.append(el("p", claim
              ? "登録している間に、この作業はほかの人が取りました。"
              : registration().row
                ? "登録できました。この「これをやります」をもう一度押すと、引き受けます。"
                : "名前を登録したら、ここに戻ってきてもう一度押してください。", "ask"));
          }
          return row;
        }));
    };

    view.onState((data, viewer) => {
      latest = { data: data || {}, viewer: viewer || {} };
      states += 1;
      render();
      // 押される前に解決しておきます。押してから訊くと gesture の印を失います。
      if (registration().known === false) void askHost();
    });

    document.addEventListener("click", async (event) => {
      const act = event.target && event.target.dataset ? event.target.dataset.act : undefined;
      if (!act) return;
      const taskId = event.target.dataset.task;
      if (act === "unarm" || act === "arm") { arming = act === "arm" ? taskId : null; render(); return; }
      // 書き込む操作だけ。上の 2 つは画面の状態で、待つものが無い。
      if (working) return;
      working = true;
      try {
        if (act === "register") {
          const input = document.getElementById("who");
          const name = input ? input.value.trim() : "";
          if (name === "") { tell("名前を入れてください。", true); return; }
          const res = await view.submit("names", { name });
          // 成立を覚えます。`viewer.mine` が来ないホストでは、ここで覚えておかないと「登録
          // しました」と言った直後の「これをやります」が、また登録から始めて id の衝突で
          // 止まります — 登録した人が永久に取れない板になる。
          if (res && res.ok) { settled = true; settledAt = states; resolved = { name }; }
          // **拒否は「既に在る」かもしれません。** 別のタブで登録した、あるいは行はできたのに
          // 応答を落とした — どちらもこの拒否になります。「行が無い」という古い答えを抱えたまま
          // だと、`askHost` は `settled` を見て二度と訊かず、この人はリロードするまで取れません。
          // なので否定のキャッシュを捨てて、訊き直させます（取りはしません）。
          else if (res && res.error !== "cancelled") forget();
          // **していないことを言います。** 「作業を取れます」は、作業を取りに来て名前を訊かれた
          // 人には「取れました」と読めます。取れていないことのほうが、この人には報せるべき知らせです。
          report(res, wanted === null ? "登録しました。作業を取れます。" : "登録しました。作業はまだ引き受けていません。", "登録できませんでした");
          if (res && res.ok) { render(); focusWanted(); }
          return;
        }
        if (act === "take") {
          // 断られたら、その作業を覚えて描き直します。**押下はここで終わりです** — 続けて
          // 取ろうとしても gesture の印が付かず、書き込みを門番するホストでは落ちます。
          if (!(await ensureRegistered())) { wanted = taskId; render(); return; }
          // uid も status も送らない。ホストがセッションと宣言から埋めます。
          const took = await view.submit("assignments", { taskId });
          if (took && took.ok) { wanted = null; render(); }
          report(took, "引き受けました。", "引き受けられませんでした。誰かが先に取ったかもしれません");
          return;
        }
        if (act === "finish" || act === "reopen") {
          const to = act === "finish" ? "done" : "doing";
          report(await view.transition("assignments", taskId, to), to === "done" ? "完了にしました。" : "未完了に戻しました。", "変えられませんでした");
          return;
        }
        if (act === "drop") {
          arming = null;
          report(await view.withdraw("assignments", taskId), "外しました。空きに戻っています。", "外せませんでした");
          render();
        }
      } finally {
        working = false;
      }
    });

    view.ready();
  })();
</script>
```

**登録を挟むと、1 つの意図が 2 回の押下に割れます。その 2 回目を、文言ではなく行で出すこと。**
これは実際に起きた勘違いです。名前を登録していない人が「これをやります」を押す → 断られて名前の
欄まで画面が飛ぶ → 名前を入れて「この名前で参加する」を押す → **作業も引き受けたつもりで板を離れる**。
無理もありません。押した結果として `#me` が「◯◯ として参加中です」に変わり、それが成功に見える
一方で、「まだ引き受けていません」はページの末尾の `#say` にあって画面の外だからです。

1 押しで書き込みを 2 回はできない（上の `ensureRegistered` の注）ので、2 回目の押下は無くせません。
無くせるのは、2 回目が**必要だと分からないこと**のほうです。`wanted` に押された作業を覚え、登録が
済んだら `focusWanted()` でその行まで画面を戻し、次の一手をその行の中に置く。そして `#say` では
**していないことを名指しで言います** — 「作業を取れます」は、作業を取りに来て名前を訊かれた人には
「取れました」と読めます。

行の文言は 3 通りあり、3 つとも要ります。まだ登録していない（「登録したら、ここに戻ってきてもう一度」）、
登録できた（「もう一度押すと引き受けます」）、そして**登録している間に取られた**。3 つ目を省いて 2 つ目を
出すと、押しても取れないボタンを案内することになります。

**`submit` に渡すのは `taskId` だけ**です。`uid` はホストがサインインしたセッションから、
`status` は `initialStatus` から埋めます — 送ろうとすると、ルールが `createFields` の一致で
拒否するのではなく、値がホストの埋めたものと食い違って落ちます。

---

## views/desk.html — オーナーの画面

`/m/{slug}` は名簿の人だけが開きます。**押せるものは `viewer.can` から引いてください** —
役割名で分岐すると、ルールを誰も読まないところに二度書くことになります。

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 295;                                    /* violet - a board that keeps a roster */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  section { margin: 0 0 16px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 18px; background: var(--fill); }
  h2 { margin: 0 0 10px; color: var(--muted); font-size: 13px; font-weight: 750; letter-spacing: .04em; }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input, textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  .task { padding: 11px 0; border-top: 1px solid var(--line); }
  .ask { margin-top: 8px; padding: 10px 12px; border-radius: 10px; background: oklch(96% .04 55); color: oklch(40% .09 55); font-size: 13px; }
  .title { flex: 1 1 200px; font-weight: 780; }
  .title .note { margin-left: 8px; font-weight: 400; }
  .who { color: var(--muted); font-size: 13px; }
  .who.mine { color: var(--main); font-weight: 750; }
  .say { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
  .say.bad { color: oklch(48% .15 25); }
  .note, .empty { color: var(--muted); font-size: 12px; }
</style>

<h1>オーナー画面</h1>
<section><h2>作業を足す</h2><div id="add"></div></section>
<section><h2>作業</h2><div id="list"><p class="empty">読み込み中…</p></div></section>
<section><h2>登録している人</h2><div id="people"><p class="empty">読み込み中…</p></div></section>
<p class="say" id="say" role="status"></p>

<script>
  (() => {
    const view = window.__MC_APP_VIEW;
    const add = document.getElementById("add");
    const list = document.getElementById("list");
    const people = document.getElementById("people");
    const say = document.getElementById("say");
    let latest = null;
    let arming = null;

    const el = (tag, text, cls) => {
      const node = document.createElement(tag);
      if (text !== undefined && text !== null) node.textContent = text;
      if (cls) node.className = cls;
      return node;
    };
    const button = (text, act, id) => {
      const node = el("button", text);
      node.type = "button";
      node.dataset.act = act;
      if (id) node.dataset.id = id;
      return node;
    };
    const tell = (text, bad) => {
      say.textContent = text;
      say.className = bad ? "say bad" : "say";
    };
    const report = (res, okText) => {
      if (res && res.ok) { tell(okText, false); return; }
      if (res && res.error === "cancelled") { tell("", false); return; }
      tell("できませんでした（" + ((res && res.error) || "unknown") + "）", true);
    };

    /** 押せるものは projection が言うことだけから引く。 */
    const capOf = (cid) => (latest.viewer.can && latest.viewer.can[cid]) || {};
    const holderName = (uid) => {
      const row = (latest.data.names || []).find((entry) => entry.id === uid);
      return row && row.name ? String(row.name) : "担当者";
    };

    /** 足せる人にだけ、入力欄を出す。
     *
     *  `/m/` は名簿に載っている人を全員通します — viewer も、別のコレクションだけ担当する人も。
     *  全員にフォームを描くと、押した人の大半がルールに拒否されます（窓は閉じていて、writer の
     *  分岐は役割が要る）。
     *
     *  **「作れるか」を言う capability はありません。** `viewer.can` が答えるのは transition /
     *  assign / withdraw だけです。このコレクションで owner / editor だけが持つ信号は
     *  `withdrawAny` なので、それを writer かどうかの代わりに読みます — `writerDelete` を
     *  宣言していないアプリにはこの信号自体が無いので、その場合は宣言するか、フォームを全員に
     *  出して拒否に語らせるかのどちらかです。
     *
     *  一度組み立てたら作り直さないこと。onState のたびに作り直すと、他の人の操作が届いた瞬間に
     *  打ちかけの文字が消えます。 */
    let addBuilt = false;
    const renderAdd = () => {
      if (capOf("tasks").withdrawAny !== true) {
        add.replaceChildren(el("p", "作業を足せるのは owner / editor だけです。", "note"));
        addBuilt = false;
        return;
      }
      if (addBuilt) return;
      buildAdd();
      addBuilt = true;
    };

    const buildAdd = () => {
      const title = el("input");
      title.type = "text";
      title.id = "t-title";
      title.maxLength = 120;
      const detail = document.createElement("textarea");
      detail.id = "t-detail";
      const due = el("input");
      due.type = "date";
      due.id = "t-due";
      const l1 = el("label", "作業"); l1.append(title);
      const l2 = el("label", "内容（任意）"); l2.append(detail);
      const l3 = el("label", "期限（任意）"); l3.append(due);
      // <form> は使えません。sandbox に allow-forms が無く、送信は submit イベントが出る前に
      // 止められます（onsubmit の preventDefault すら走りません）。
      add.replaceChildren(l1, l2, l3, button("この作業を足す", "add"));
    };

    const taskRow = (task, claim) => {
      const claims = capOf("assignments");
      const tasks = capOf("tasks");
      const row = el("div", null, "task");
      row.append(el("div", String(task.title || task.id)));
      row.append(el("span", claim ? holderName(claim.uid) + (claim.status === "done" ? " が完了" : " が作業中") : "空き", "who"));
      const acts = el("div");
      if (claim && claims.transitionAny === true) {
        acts.append(button(claim.status === "done" ? "未完了に戻す" : "完了にする", claim.status === "done" ? "reopen" : "finish", task.id));
      }
      // writerDelete は状態を問いません。`doing` に絞るのはこのページの判断で、終わった記録を
      // 一手で消せないようにしています（消すなら先に「未完了に戻す」）。
      if (claim && claims.withdrawAny === true && claim.status === "doing") acts.append(button("担当を外す", "arm-claim", task.id));
      if (tasks.withdrawAny === true) acts.append(button("この作業を消す", "arm-task", task.id));
      if (acts.childElementCount > 0) row.append(acts);

      if (arming && arming.id === task.id) {
        const ask = el("div", null, "ask");
        if (arming.kind === "claim") {
          ask.append(el("span", "外すと、すぐ他の人が取れるようになります。 "), button("はい", "drop-claim", task.id), button("やめる", "unarm"));
        } else if (claim) {
          // 消せてしまいますが、消すと担当の行が宙に浮きます（行 id はこの作業の id のまま
          // 残り、板からは消える）。ルールには書けないので、ここで止めます。
          ask.append(el("span", "この作業には担当がいます。先に担当を外してください。 "), button("わかった", "unarm"));
        } else {
          ask.append(el("span", "この作業を消します。元に戻せません。 "), button("はい", "drop-task", task.id), button("やめる", "unarm"));
        }
        row.append(ask);
      }
      return row;
    };

    const render = () => {
      if (latest === null) return;
      renderAdd();
      const tasks = latest.data.tasks || [];
      const held = new Map((latest.data.assignments || []).map((row) => [row.id, row]));
      list.replaceChildren(...(tasks.length === 0
        ? [el("p", "まだ作業がありません。", "empty")]
        : tasks.slice().sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))).map((task) => taskRow(task, held.get(task.id) || null))));
      const names = latest.data.names || [];
      people.replaceChildren(...(names.length === 0
        ? [el("p", "まだ誰も名前を登録していません。", "empty")]
        : names.map((row) => el("div", String(row.name || row.id)))));
    };

    view.onState((data, viewer) => {
      latest = { data: data || {}, viewer: viewer || {} };
      render();
    });

    document.addEventListener("click", async (event) => {
      const data = event.target && event.target.dataset ? event.target.dataset : {};
      if (!data.act) return;
      if (data.act === "unarm") { arming = null; render(); return; }
      if (data.act === "arm-claim" || data.act === "arm-task") {
        arming = { kind: data.act === "arm-claim" ? "claim" : "task", id: data.id };
        render();
        return;
      }
      if (data.act === "add") {
        const title = document.getElementById("t-title");
        const detail = document.getElementById("t-detail");
        const due = document.getElementById("t-due");
        if (title.value.trim() === "") { tell("作業の名前を入れてください。", true); return; }
        // 運べるのは文字列だけ。空の欄はホストが record から落とします。
        const res = await view.submit("tasks", { title: title.value.trim(), detail: detail.value.trim(), due: due.value });
        if (res && res.ok) { title.value = ""; detail.value = ""; due.value = ""; }
        report(res, "足しました。");
        return;
      }
      if (data.act === "finish" || data.act === "reopen") {
        report(await view.transition("assignments", data.id, data.act === "finish" ? "done" : "doing"), "変えました。");
        return;
      }
      if (data.act === "drop-claim" || data.act === "drop-task") {
        arming = null;
        const cid = data.act === "drop-claim" ? "assignments" : "tasks";
        report(await view.withdraw(cid, data.id), cid === "tasks" ? "作業を消しました。" : "担当を外しました。");
        render();
      }
    });

    // `buildAdd()` はここでは呼びません。誰に出すかは capability が決め、それが届くのは
    // `onState` です。
    view.ready();
  })();
</script>
```

**入力欄も操作も、`viewer.can` が言うぶんだけ描くこと。** `/m/` は名簿に載っている人を全員
通すので、viewer にも別のコレクション担当にも同じページが渡ります。全員にフォームを出すと、
その人たちには**必ず失敗するボタン**を渡すことになります（窓は閉じていて、writer の分岐は
役割を要求する）。

ただし**「作れるか」を言う capability はありません** — `viewer.can` が答えるのは transition /
assign / withdraw の 3 つだけです。上のページは `tasks` の `withdrawAny` を writer かどうかの
代わりに読んでいます。`writerDelete` を宣言していないアプリには writer の信号が無いので、
そのときは宣言するか、フォームを全員に出して拒否に語らせるかのどちらかを選んでください。

**`withdrawAny` が false のときは、ボタンを描かないこと。** 出しても押した全員がルールに
拒否されます。false になるのは、`writerDelete` を宣言していないか、この読み手が owner /
editor ではないか、**アプリを再 publish していない**かのどれかです（capability は publish が
書いた文書から作られるので、宣言だけ直しても届きません）。

---

## なぜ付け替えられないのか

「A さんの担当を B さんに移す」は、この形では**できません**。ルールが `uidField` を
create のときだけ許し、そのあと凍結するからです — 誰も、オーナーも、他人の uid を
書き込めません。書けたら「本人が送った行」という意味がなくなります。

できるのは 2 手です: **オーナーが外す（`writerDelete`）→ B さんが取る**。板は空きに戻るので、
B さんの操作は普通の「これをやります」になります。

**配る側が主役の設計にしたいなら、テンプレートを変えてください。** `assigneeField` は
アドレスを持ち、`assign` の操作で付け替えられます — 代わりに担当者は**名簿の人**でなければ
ならず（役割を持たない人には振れません）、アドレスが行に載ります。それが
[salon.md](./salon.md) の形です。この板は「取りに来る人が主役」で、名簿はアドレスを
持たない参加者の一覧にすぎません。

---

## 公開範囲を狭める

`public.read` に何を入れるかで、URL を知っている人に見えるものが決まります。

- **`["tasks", "names", "assignments"]`**（このテンプレート）— 誰が何をやっているかが全部見える板。
- **`["tasks", "assignments"]`** — 名前が引けなくなるので、板は「空き／作業中」だけになります。
  担当者は自分の行だけ分かる（`viewer.mine`）。
- **`["tasks"]`** — 作業一覧だけ。取ることはできますが、他人の担当は見えません。**`idIn` は
  read とは無関係**なので、これでも先着の衝突は効きます。

**uid は不透明でも「同じ人」を追える識別子**です。同じアプリの複数の行が同じ uid を持てば、
同じ人の仕事だと分かります。板の目的そのものなので普通は問題になりませんが、
「誰がやったか分からないようにしたい」板には向きません。

---

## 落とし穴

- **公開ページに `viewer.mine` が来ないことがあります。** ホストが読めなかったとき（refuse、
  一時的な失敗）はキーごと来ません。**空の配列ではありません** — 空は「あなたは登録していない」、
  キー無しは「誰も読んでいない」。取り違えると、登録済みの人に登録欄を出し続けます。

  **そして「来ない」を通す側に倒すと、名前の無い担当ができます。** 取り違えの被害は登録欄が
  余分に出ることだけではありません — 上の `askHost` と `ensureRegistered` は、そのために
  書いてあります。**`viewer.mine` が答えないなら `view.mine` に訊けます**（同じ投影が返ります）。
  それでも答えないのは `lookup` を配線していないホストだけで、そこは何も書きません。
- **`confirm()` は無視され、`false` を返します。** `if (!confirm(…)) return;` と書くと、
  ボタンは黙って何もしないものになります。訊くならページの中の要素で（上の 2 度押し）。
- **担当を消すと記録は残りません。** `withdraw` は削除です。誰がいつ降りたかを残したいなら、
  `selfDelete` を宣言せず、`doing → dropped` のような状態を足す設計にしてください。
  `mail` も削除には紐づけられません（キューのルールは書き込み後の文書を読むので、無い文書には
  反応できません）。
- **作業を消すとき、担当の行は道連れになりません。** 行 id は作業 id のままそこに残り、板からは
  消えます（`tasks` が無いので描かれない）。ルールに「先に担当を外せ」は書けないので、
  上の画面のように**ページで止めます**。

  **そしてページで止まるのは、押した瞬間に見えていた分だけです。** オーナーが確認を出してから
  「はい」を押すまでの間に誰かが取ると、**宙に浮いた担当の行ができます**。これは宣言では
  塞げません — ルールが見られるのは書き込む文書とその周辺だけで、「別のコレクションに行が無いこと」を
  条件にする語彙がこの宣言言語にはない（`mirror` は 2 つの書き込みを 1 バッチに縛る仕掛けで、
  「無いこと」の検査ではありません）。

  残るのは、**起きたときに何が壊れるかを知っておくこと**と、確率を下げる書き方です:

  - **消す順番を「担当 → 作業」にする。** 途中で失敗しても、残るのは「担当のいない作業」＝
    ただの空き作業で、壊れた状態ではありません。逆順は宙に浮いた行を作ります。
  - **宙に浮いた行は、同じ id の作業を作り直したときに効いてきます。** 行 id は作業 id なので、
    その作業は**誰も取れません**（create が既存文書への書き込みになる）。直すにはその行を
    消すしかない — コレクションペインからです。
  - **消さない設計にできるなら、その方が強い。** `tasks` に `statusField` と
    `transitions: { open: ["archived"], archived: ["open"] }` を足し、削除ではなく
    `archived` へ動かす。板は `open` だけを描けばよく、担当の行は残ったままなので宙に浮きません。
    記録も残ります。**参加者が多い板ではこちらを勧めてください** — 削除は「もう二度と使わない」
    作業にだけ。
- **`writerDelete` は `@receptron/sharedapp` 0.20.0 から**です。それ以前のホストでは
  `viewer.can.<cid>.withdrawAny` が `undefined` になり、オーナー画面の削除は描かれません。
  古い回避策（オーナーのページを `audience: "participant"` にする）は**使わないでください** —
  担当の付け替えも受付側の遷移表も失う書き方です。
- **オーナーが `/m/` を開けるのは、名簿に載っているからです。** `members` に自分を書き忘れた
  アプリは publish を拒否されますが、editor を足したのに再 publish していないアプリは
  「開けるが何も押せない」になります（capability は publish が書いた文書から作られます）。
