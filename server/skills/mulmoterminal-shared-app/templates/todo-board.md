# テンプレート: 作業を取り合う板（共有 TODO・当番表・引き受けリスト）

**いつ使うか** — 仕事が並んでいて、**ログインした人が「これは自分がやります」と取る**もの。
共有 TODO、当番表、翻訳やレビューの引き受け、備品の修理依頼。承認は無く、取った時点で
その人のものになります。

**他の 5 つと違うのは、住所を集めないこと**です。板には「誰がやっているか」が出るのに、
メールアドレスはどこにも保存されません。それを可能にしているのが `uidField` で、
このテンプレートはそのために書かれています。

**最初に利用者へ言うこと**が 2 つあります:

- **担当の付け替えはできません。** 本人が外して、次の人が取る、の 2 手になります（下の
  「なぜ付け替えられないのか」）。
- **板に出る名前は自己申告**です。ルールは名前を検証しません（検証できるのはサインインした
  本人であることだけ）。

---

## 中心にある考え方 — id は排他に使い切っている

「2 人が同じ作業を取れない」を成立させるのは、**ドキュメント id の衝突**です（原則 4）。
申込み（claim）の id を作業（task）の id にすると、2 人目の書き込みは**既に在る文書への
書き込み**になり、公開の申込み経路は create しか許していないので拒否される。

すると **id はもう本人性に使えません**。「これは誰の行か」はフィールドに置くしかない。

フィールド版の身元は 2 つあります:

| | 保存されるもの | 板に出せるか |
|---|---|---|
| `emailField` | 本人のメールアドレス | 出せるが、**行を公開すると住所も公開**される |
| `uidField` | サインイン結果の uid（不透明な文字列） | 出せる。**住所はどこにも無い** |

ルールはフィールドを隠せず、可視性の境界はドキュメントです（原則 5）。だから「担当者が
見える板」を公開するなら、その行の**全フィールド**が世界に読める。`emailField` の板は
名前と一緒にメールアドレスを配ることになり、`uidField` の板は配りません。**それが唯一の
違いで、この形を選ぶ理由のすべて**です。

---

## app.json

```json
{
  "aid": "(init が書きます。手で触らないこと)",
  "name": "今週の作業",
  "slug": "team-todo",
  "protocol": "1.0.0",
  "members": {
    "owner@example.com": { "*": "owner" }
  },
  "collections": {
    "tasks": {},
    "claims": {
      "submitOnly": true,
      "statusField": "status",
      "transitions": { "initial": ["doing"], "doing": ["done"], "done": ["doing"] },
      "writerDelete": true
    }
  },
  "views": [
    { "id": "public", "audience": "public", "path": "views/board.html", "collections": ["tasks", "claims"] },
    { "id": "desk", "audience": "member", "path": "views/desk.html", "collections": ["tasks", "claims"] }
  ],
  "public": {
    "enabled": true,
    "read": ["tasks", "claims"],
    "submit": {
      "claims": {
        "auth": "verifiedEmail",
        "uidField": "uid",
        "createFields": ["taskId", "name", "uid", "status"],
        "initialStatus": "doing",
        "idFrom": "field",
        "idField": "taskId",
        "idIn": { "collection": "tasks" },
        "validate": { "required": ["name"] },
        "selfUpdate": { "doing": ["name"] },
        "selfTransitions": { "doing": ["done"], "done": ["doing"] },
        "selfDelete": ["doing"]
      }
    }
  }
}
```

**`protocol` は他のテンプレートと同じ `"1.0.0"` のままです。** `uidField` に専用の版は
ありません。古いビルドは、このキーを知らなければ宣言の検査で `Unrecognized key: "uidField"` と
言って止まりますし、古いブラウザのタブは `submit` と `form` の整合検査で落ちて、このアプリを
**描かずに「読めません」と言います**（uid は `createFields` にあってフォームには無いので、
その組み合わせが拒否されます）。それが正しい壊れ方で、「uid を入力してください」という箱を
描いて全部拒否されるよりずっとよい。

**`uid` は `createFields` に入り、しかしフォームには絶対に描かれません。** 入っているのは
ルールが「createFields の外のキーは拒否」するからで、埋めるのはページです。あなたが書く
ページからも**入力させないでください** — uid は誰も打てないので、その箱に入る値は全部拒否されます。

**`members` は owner だけ**です。取る人は名簿に載りません。これがこの形のもう半分で、
「参加者を列挙しないと始まらない」アプリにならずに済みます。

**`auth` は `verifiedEmail` か `anonymous`**。`anonymous` にすると住所どころかサインインも
要りませんが、**ブラウザを閉じると自分の行に触れなくなります**（uid がセッションのもの
だから）。取り下げも完了も押せなくなるので、板が数日続くなら `verifiedEmail` を勧めてください。

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

作業そのものは owner が入れます（コレクションペイン、またはこのリポジトリの `tasks` スキル）。
主キーは**読める合成スラッグ**にしてください（`translate-readme`）— claim の id がこの id に
なるので、運用中に目で追えます。

## .claude/skills/claims/schema.json

```json
{
  "title": "担当",
  "icon": "front_hand",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "taskId": { "type": "string", "label": "作業", "required": true },
    "name": { "type": "string", "label": "名前", "required": true },
    "uid": { "type": "string", "label": "本人" },
    "status": { "type": "enum", "label": "状態", "values": ["doing", "done"], "required": true }
  }
}
```

**`uid` は `string` で宣言します。** `email` 型にしてはいけません — スキーマが「住所」と
言っている欄に、ルールがセッション id を比べに来ることになります（`check` が止めます）。

---

## なぜ付け替えられないのか

`uid` は create のあと**凍結されます**（ルールの `uidHeld`）。owner でも書き換えられません。

これは制限に見えて、実は**書けないものを書かないための設計**です。uid は不透明な文字列で、
誰も手で入力できない — つまり「B さんに付け替える」という操作の UI が作れない。書き換えを
許しても、行を失う経路が 1 本増えるだけです。

なので運用はこうなります:

- **本人が降りる** — `selfDelete: ["doing"]` で自分の claim を消す。作業は空きに戻る。
- **受付が空ける** — owner が claim を消す（放置された `doing` を開放できるのは owner だけ）。
- **引き継ぎ** — 消してから、次の人が取る。**2 手**であり、途中で第三者に取られる可能性が
  あります。それが困る規模なら、承認のある形（[salon.md](./salon.md)）のほうが合っています。

「作業中のものは担当を変えられない」という規則は、**宣言では書けません**。ルールに
「フィールド B が doing の間はフィールド A を凍結」という書き方が無く、ここでは uid が
常に凍結されているので、実質「いつでも変えられない」になります。

## 誰が何を押せるか

| 操作 | 誰が | どう宣言されているか |
|---|---|---|
| 取る | サインインした誰でも | `public.submit.claims`（id 衝突で 1 人だけ） |
| 名前を直す | 取った本人 | `selfUpdate: { "doing": ["name"] }` |
| 完了にする | 取った本人 | `selfTransitions: { "doing": ["done"] }` |
| 作業中を解除して降りる | 取った本人 | `selfDelete: ["doing"]` |
| 他人の担当を消す | owner のみ | `collections.claims.writerDelete: true` |
| 作業を足す・消す | owner のみ | `tasks` は公開の submit を持たない |

**`done` は取り下げられません**（`selfDelete` は `doing` のみ）。終わった記録を残すためで、
やり直すときは `done → doing` に戻してから降ります。

**完了を押せるのは本人だけ**です。「終わってるのに done になっていない」を他人が閉じたい
なら、それは owner の操作になります。ここを開くと `selfTransitions` ではなく writer の
権限の話になるので、最初にどちらか決めてください。

## views/board.html — 取る画面

**`<form>` もモーダルも使えません。** ビューは `sandbox="allow-scripts"` の中にいて、
`allow-forms` も `allow-modals` もありません — `<form>` は送信ごと止められ（`onsubmit` の
`preventDefault()` すら走りません）、`prompt` / `alert` / `confirm` は無視されます。
`<div>` と `type="button"` にして、訊くのも報せるのもページの中の要素で。

The colours below all come from one `--hue`, and **it is meant to be changed** — this one is
this template's, not your app's. The rules behind the sheet, and how to go further than these
fifteen lines, are in [design.md](./design.md).

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 155;                                    /* green - work taken and given back */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input:not([type="radio"]), textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  #list > div, #rows > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say, #note { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<label>お名前 <input id="who" maxlength="40" /></label>
<p id="say" role="status"></p>
<div id="list"></div>
<script>
  const view = window.__MC_APP_VIEW;
  const list = document.getElementById("list");
  const who = document.getElementById("who");
  const say = document.getElementById("say");
  view.onState(({ tasks = [], claims = [] }) => {
    const takenBy = Object.fromEntries(claims.map((claim) => [claim.taskId, claim]));
    list.replaceChildren(
      ...tasks.map((task) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        // textContent と dataset。作業名も名前も人が書いたものなので、文字列連結で
        // innerHTML に入れると公開ページで <script> が動きます。
        label.textContent = task.title ?? task.id;
        row.append(label);
        const claim = takenBy[task.id];
        if (claim) {
          const note = document.createElement("span");
          // uid は出しません。人が読むのは名前で、uid はルールが読むものです。
          note.textContent = claim.status === "done" ? ` — ${claim.name} が完了` : ` — ${claim.name} が作業中`;
          row.append(note);
        } else {
          const button = document.createElement("button");
          // type を書くこと。省略した <button> は submit ボタンで、サンドボックスが止める側の形です。
          button.type = "button";
          button.dataset.task = task.id;
          button.textContent = "これをやります";
          row.append(button);
        }
        return row;
      }),
    );
  });
  list.addEventListener("click", async (event) => {
    const taskId = event.target.dataset?.task;
    if (!taskId) return;
    const name = who.value.trim();
    if (name === "") {
      say.textContent = "お名前を入れてください。";
      who.focus();
      return;
    }
    // uid は送りません。ホストがサインインしたセッションから入れます — 送っても
    // 上書きされますが、書いてあると次に読む人が「入力させる欄だ」と読みます。
    const result = await view.submit("claims", { taskId, name, status: "doing" });
    if (result.ok) {
      say.textContent = "引き受けました。";
      return;
    }
    // 失敗を 1 つの文言にまとめないこと。取られた・サインインしていない・名前が空、
    // どれでも ok:false で返ります。"cancelled" は失敗ですらありません（確認で「やめる」）。
    if (result.error === "cancelled") {
      say.textContent = "";
      return;
    }
    say.textContent = result.error ? `引き受けられませんでした: ${result.error}` : "その作業は取られました。";
  });
  view.ready();
</script>
```

**自分の行かどうか**は `view.mine("claims", taskId)` で訊けます（`{ found, known }`）。
**プレビューでは常に `known: false`（分からない）が返る**ので、分からない側の枝がまともに
見えることを確認してください — 本番でだけ現れる分岐は、一度も走らないまま緑になります。
「完了にする」「降りる」のボタンをここに出すなら、その枝です。

## views/desk.html — 受付の画面

`/m/{slug}` は名簿の人（ここでは owner）だけが開きます。放置された `doing` を消して作業を
空けるのはここ。**誰の行かは uid でしか分からない**ので、板と同じ「名前」を見て判断する
ことになります — 名前は自己申告だと承知しておいてください。

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 155;                                    /* green - work taken and given back */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input:not([type="radio"]), textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  #list > div, #rows > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say, #note { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<p id="note" role="status"></p>
<div id="rows"></div>
<script>
  const view = window.__MC_APP_VIEW;
  const rows = document.getElementById("rows");
  const note = document.getElementById("note");
  // 誰の担当でも消してよいか。owner / editor だけ true になります（`writerDelete` +
  // 名簿）。false のまま描くと、押した人全員がルールに拒否されます。
  let mayRemove = false;
  view.onState(({ tasks = [], claims = [] }, viewer) => {
    mayRemove = viewer?.can?.claims?.withdrawAny === true;
    const title = Object.fromEntries(tasks.map((task) => [task.id, task.title ?? task.id]));
    rows.replaceChildren(
      ...claims.map((claim) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        label.textContent = `${title[claim.taskId] ?? claim.taskId} — ${claim.name}（${claim.status}）`;
        row.append(label);
        if (mayRemove) row.append(removeButton(claim));
        return row;
      }),
    );
    note.textContent = claims.length === 0 ? "まだ誰も取っていません。" : "";
  });

  // 2 度押しで訊きます。`confirm()` はサンドボックスが無視して false を返すので、
  // ガードに使うとボタンが黙って効かなくなります。
  function removeButton(claim) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "担当を外す";
    let armed = false;
    button.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        button.textContent = "本当に外す？";
        return;
      }
      button.disabled = true;
      const result = await view.withdraw("claims", claim.id);
      // 行は消えて状態が届き直します。失敗したときだけ、ここに残る文言が要ります。
      if (!result.ok) {
        button.disabled = false;
        armed = false;
        button.textContent = "担当を外す";
        note.textContent = `外せませんでした: ${result.error ?? "理由なし"}`;
      }
    });
    return button;
  }
  view.ready();
</script>
```

**行は消えます。** `withdraw` は削除で、`done → 空き` に戻す遷移ではありません。誰が取って
いたかの記録は残らず、`mail` も紐づけられません（キューのルールは書き込み後の文書を読むので、
無い文書には反応できません）。記録を残したいなら、消さずに `done` のまま置いて別の状態を
足す設計にしてください — どちらにするかはユーザーに訊いて決めます。

**`writerDelete` は `@receptron/sharedapp` 0.20.0 から**で、それ以前はビューから他人の行を
消す経路が本当にありませんでした。owner のページを `audience: "participant"` にして回避した
アプリが実在しますが、それは担当の付け替え（assign）と受付側の遷移表を失う書き方なので、
真似しないでください。宣言しない場合に残る道はコレクションペインからの削除です。

---

## 落とし穴

- **公開する = 名前が世界に出る。** `public.read` に `claims` を入れた時点で、その行は
  URL を知っている全員に読めます。出るのは名前・作業・状態・uid で、**メールアドレスは
  ありません**が、名前を出すこと自体の可否は最初に確認してください。社内だけに見せたいなら
  `claims` を `public.read` から外し、`/m/` だけで担当を見る形にします（板は「空き／作業中」
  だけになります）。
- **uid は不透明でも「同じ人」を追跡できる識別子**です。同じアプリの複数の行が同じ uid を
  持てば、同じ人の仕事だと分かります。それは板の目的そのものなので普通は問題ありませんが、
  匿名性を約束するアンケートに `uidField` を持ち込まないこと。
- **`anonymous` の uid は browser profile のもの**で、閉じれば失われます。数分で終わる板
  以外では `verifiedEmail` を選んでください。
- **フォームに uid を描かない。** publish の投影も、ページも、どちらも描きません。手書きの
  ページで input を作ってしまうと、訪問者が埋めた値は上書きされ（ホストが session の uid を
  後から入れる）、その箱は「埋めても何も起きない欄」になります。
- **live は要りません。** 板が動くのは人が押したときだけで、`views[].live` を足すと
  `claims` は全員が書くコレクションなので扇形が N→N になり、publish が拒否します
  （[live-poll.md](./live-poll.md) の表を読んでください）。

## 手順

1. `manageSharedApp` の `init`（名前と slug）。
2. `.claude/skills/tasks/` と `.claude/skills/claims/` に `SKILL.md` と `schema.json` を書く
   （`storage: {"type":"firestore"}`）。
3. `app.json` に上の宣言を書く。
4. `check` — `uidField` がスキーマに実在するか、`createFields` に入っているか、`selfUpdate` に
   入っていないかを、ここが全部見ます。
5. `preview` — 実ブラウザでページを走らせる。既定では**何も書かない**ので、押下が
   ルールに通るかは `confirm: true` を渡したときだけ分かります（実レコードを書きます）。
6. `publish`。板の URL は `/a/{slug}`、受付は `/m/{slug}`。
