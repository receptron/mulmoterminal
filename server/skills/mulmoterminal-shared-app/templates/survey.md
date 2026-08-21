# テンプレート: 答えを集める（アンケート・診断・応募フォーム）

奪い合いが無い形です。定員も、解禁時刻も、順位もない。**答えを集めて、集めた答えを読む**、
それだけ。だから宣言はこの 3 つの中で一番短く、書くのも一番早い。

**落とし穴はそこ一つです。** 公開ページが動いた時点で完成したように見えるのに、その時点では
**集めた答えを誰も見られません**。著者は自分の Mac のコレクションペインからなら読めるので、
気づくのは人に配ったあと — 「回答は来ていますか」と訊かれて、母艦を開きに行くときです。

このテンプレートが他の 2 つと違うのは、**`member` のページを最初から数に入れている**ことだけ
です。予約ものは受付の画面を作る理由が最初から目に見えていますが、アンケートは見えない。

## 中心にある考え方 — ページは「公開」だけではない

入口は 3 つあり、`views` に書いたものだけが存在します。

| 入口 | 誰が開けるか | このアプリでの意味 |
|---|---|---|
| `/a/{slug}` | 誰でも（サインインは宣言次第） | 答える画面 |
| `/m/{slug}` | `members` にロールを持つ人 | **集まった答えを読む画面。これが要る** |
| `/p/{slug}` | `members` に載っている人 | 自分の答えを見返す画面。**下記の分岐**を読むこと |

`/m/` を書かないアプリは、著者の Mac が起きていないと結果が読めないアプリです。共有アプリに
した意味の半分がそこで消えるので、**`member` のページは既定で作ってください**。要るかどうかを
ユーザーに訊く必要はありません（訊くべきなのは `/p/` のほう、下記）。

## app.json

```json
{
  "aid": "(init が書きます)",
  "name": "講演アンケート",
  "slug": "talk-survey",
  "protocol": "1.0.0",
  "members": {
    "owner@example.jp": { "*": "owner" }
  },
  "collections": {
    "responses": {
      "submitOnly": true,
      "statusField": "status"
    }
  },
  "public": {
    "enabled": true,
    "read": ["questions"],
    "submit": {
      "responses": {
        "auth": "verifiedEmail",
        "emailField": "email",
        "idFrom": "auth.uid",
        "stampField": "answeredAt",
        "initialStatus": "submitted",
        "createFields": ["email", "name", "answers", "comment", "answeredAt", "status"]
      }
    }
  },
  "views": [
    { "id": "public", "audience": "public", "path": "views/survey.html", "collections": ["questions"] },
    { "id": "desk", "audience": "member", "path": "views/desk.html", "collections": ["questions", "responses"] }
  ]
}
```

**`protocol` は publish 契約の版**です。宣言は**下限**で、publish される値ではありません
（文書が守るのは、それを射影した compiler の版）。宣言より古い publisher は**拒否**されるので、
新しい書き方に頼ったアプリが、それを実装していない publisher に黙って通ることがありません。
何も宣言しないアプリは `1.0.0` — このキーが無かった頃に publish されたアプリはそれです。

## .claude/skills/questions/schema.json

```json
{
  "title": "設問",
  "icon": "quiz",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "order": { "type": "number", "label": "順番", "required": true },
    "text": { "type": "string", "label": "設問", "required": true },
    "choices": { "type": "text", "label": "選択肢（1 行 1 つ）", "required": true }
  }
}
```

## .claude/skills/responses/schema.json

```json
{
  "title": "回答",
  "icon": "assignment_turned_in",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "name": { "type": "string", "label": "お名前" },
    "email": { "type": "email", "label": "メール", "required": true },
    "answers": { "type": "text", "label": "回答（JSON）", "required": true },
    "comment": { "type": "text", "label": "自由記述" },
    "answeredAt": { "type": "datetime", "label": "回答日時", "required": true },
    "status": { "type": "enum", "label": "状態", "values": ["submitted", "reviewed"] }
  }
}
```

---

## 効いている宣言 4 つ

### `idFrom: "auth.uid"` — 1 人 1 件、書き直しではなく拒否

ドキュメントの id が回答者本人になります。二度目の送信は**既にあるドキュメントを作ろうとする
create** なので、上書きではなく拒否されます。「1 回だけ答えられます」を本当に守るのはこれ
だけで、**ページ側のフラグ（送信済みだからボタンを無効に）は守りません** — 再読込みで消える
ので、宣言していなければ同じ人の行が何件でも増えます。

`gym.md` の `auth.uid+field` は「1 人 1 クラス」。こちらは field を足さない形で、「1 人 1 件」。

**回数を数えたい調査（毎月の定点観測）ならこれを外します。** そのときは 1 人が何件でも書ける
ので、desk 側で最新だけを見るのか全部見るのかを決めてください。

### `emailField: "email"` — ページは住所を送らない

サインインした人の**確認済みアドレスを親が入れます**。ページから送ると、送った値が本人のもの
かどうかをルールが確かめられないので拒否されます。`createFields` には**書きます**（親が入れる
キーも、書き込まれるキーである以上ここに無いと拒否されます）。

### `stampField: "answeredAt"` — 時刻はサーバのもの

保存されるのはサーバの時刻、ページに渡るのは `…Z` で終わる文字列です。**辞書順がそのまま
時刻順**なので、並べ替えは素の文字列比較でよく、`new Date()` に通す必要はありません。
自分で `toISOString()` を書いて送ることはできません（publish が拒否します）。

### `submitOnly: true` — 水増しを防ぐ

公開の入口から入ってきた行を、あとから誰かがまとめて足せないようにします。集計を出す
アプリでは、これが「その数字が本当に人から来た」の根拠です。

---

## 回答者に自分の答えを見せるには — **作る前にしか選べません**

ここは訊く価値のある唯一の分岐です。**「答えた人が、あとで自分の回答を見返せる必要があるか」**
を、その言葉で訊いてください。答えによって道が 3 つに分かれ、うち 1 つは行き止まりです。

- **(a) 公開ページを自分で書かない。** `views` から `public` を落とすと、宣言から**生成される
  フォーム**が使われます。これには「あなたの回答」を出す画面が最初から付いていて、名簿に
  載っていない回答者にも見えます。そのときの `views` は `desk` の 1 枚だけ — それで完成して
  いるアプリです。

  ただし**生成されるフォームが描くのは `createFields` に並んだ欄**です。この形を取るなら、
  設問はコレクションではなく**宣言のフィールドとして 1 問 1 つ並べます**
  （`"createFields": ["email", "satisfaction", "wouldRecommend", "comment", …]`）。代償は
  **設問を 1 つ変えるたびに publish し直すこと**、そして設問が回答の履歴に焼き付くことです。
  設問が固まっていて数が知れているなら、これが一番安い形です。

- **(b) 名簿に載せて `/p/{slug}`。** `audience: "participant"` のページを足します。ただし
  **participant のページは名簿に載っている人しか開けません**。招待制のアンケートなら自然な形、
  誰でも答えられるアンケートなら、答えた全員を招待する覚悟があるときだけ。

- **(c) 自分で書いた公開ページ + 誰でも答えられる。→ 今は見せられません。** カスタムの公開
  ページは生成フォームを**置き換える**ので、(a) の「あなたの回答」ごと消えます。そして公開
  ページに渡せるデータは `public.read` にあるものだけで、`responses` はそこに入れられない
  （入れたら全員の回答が世界中から読めます）。**回答者に見せられるのは、送る前にページが手元で
  持っている値だけ**です。

  下の `views/survey.html` はこの (c) の形で、**このテンプレートが (c) を選んでいる理由は
  設問をコレクションに置いたから**です。設問が `questions` にあって答えが 1 つの `answers` に
  詰まる以上、生成フォームが描けるのは「answers という名前の大きな入力欄」1 つで、それは
  アンケートではありません。設問を publish なしで足したい、採点してその場で結果を返したい —
  そういうときに (c) を選び、**そのときは回答者に見せ返すことを諦める**、という取引です。

  そして、その画面が出すのは「いま答えた結果」であって「保存された回答」ではない、と
  **ページの文言で言うこと** — 「保存しました。あとでここから見られます」は書けません。
  嘘になります。

---

## ページは 2 枚書きます

守る点は 3 つ。どれを破っても**例外は出ず、画面も変わりません**:

- **`<form>` は使えない。** `sandbox="allow-scripts"` に `allow-forms` が無く、ブラウザは
  `submit` イベントを**発火する前に**送信を止めます。`<div>` と `type="button"` のボタンにして
  **click** で `submit()` を呼びます。入力欄での Enter と `required` も同じ理由で効きません。
- **`prompt` / `alert` / `confirm` は無視されます**（`allow-modals` が無い）。訊くのはページの中の
  `<input>`、報せるのはページの中の要素です。
- **`onState` を張ったら最後に `ready()`。** 呼ばないとデータは永久に来ず、「読み込み中」の
  ままです。

そしてもう 1 つ、**選ばせるものは `<input>` にすること。ボタンで選ばせてはいけません。**
`action: "preview"` は**押すたびにページを新しく mount し直します**（1 回の押下の判定を、その前に
何を押したかから切り離すため）。なので「クリックで選ぶ」形にすると、送信ボタンを押す頃には
選択が全部消えていて、**送信は空のまま通り、プレビューは「送信ボタンは何も起こさない」と報告
します**。押せるコントロールの上限も 6 個なので、選択肢がボタンだと送信ボタンまで順番が回って
きません。ラジオ・チェックボックス・`<select>` はプレビューが**押す**のではなく**埋める**側なので、
押される候補は送信ボタンだけになり、実際の書き込みまで通して試されます。

ラジオにはもう 1 つ効用があります。`aria-pressed` を切り替えるだけのボタンは支援技術には
状態が伝わりますが、**目で見て選択済みだと分かる見た目は付きません**（押している間の
見た目はポインタを離すと戻ります）。ラジオはブラウザ自身が選択状態を描きます。

### views/survey.html

読めるのは `questions` だけ。`email` と `status` と `answeredAt` は親が入れるので送りません。

The colours below all come from one `--hue`, and **it is meant to be changed** — this one is
this template's, not your app's. The rules behind the sheet, and how to go further than these
fifteen lines, are in [design.md](./design.md).

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 265;                                    /* indigo - answers, and nothing to run out of */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input:not([type="radio"]), textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  h2 { margin: 26px 0 10px; font-size: 17px; letter-spacing: -.02em; }
  #list fieldset { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #list legend { padding: 0 6px; font-weight: 780; }
  #list label { display: flex; align-items: center; gap: 9px; margin: 8px 0 0; color: var(--ink); font-size: 15px; font-weight: 400; cursor: pointer; }
  #tally > div, #comments > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say, #count { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<h1>講演アンケート</h1>
<div id="list"></div>
<label>お名前 <input id="who" maxlength="40" /></label>
<label>ご意見 <textarea id="comment" maxlength="1000"></textarea></label>
<button id="send" type="button">送信する</button>
<p id="say" role="status"></p>
<script>
  const view = window.__MC_APP_VIEW;
  const list = document.getElementById("list");
  const say = document.getElementById("say");
  let questions = [];

  view.onState(({ questions: rows = [] }) => {
    questions = rows.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    list.replaceChildren(
      ...questions.map((question) => {
        // textContent で組み立てること。設問も選択肢も人が入力するもので、文字列連結で
        // innerHTML に入れると公開ページでそれが動きます。
        //
        // fieldset + legend で束ねます。設問文がただの <p> だと、読み上げで聞こえるのは
        // 「良い、ラジオボタン」だけで、どの設問への答えなのかが分かりません。
        // <fieldset> は <form> ではないので、サンドボックスの制約とは無関係です。
        const box = document.createElement("fieldset");
        const text = document.createElement("legend");
        text.textContent = question.text ?? question.id;
        box.append(text);
        for (const choice of String(question.choices ?? "").split("\n").filter((line) => line.trim() !== "")) {
          // ボタンではなくラジオ（理由は下）。同じ設問の選択肢は name で 1 つに束ねます。
          // <form> は要りません — 束ねるのは name であって form ではないからです。
          const line = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `q-${question.id}`;
          radio.value = choice;
          radio.dataset.question = question.id;
          const caption = document.createElement("span");
          caption.textContent = choice;
          line.append(radio, caption);
          box.append(line);
        }
        return box;
      }),
    );
  });

  // セレクタに id を差し込まず、属性で突き合わせます。設問 id は人が付けるもので、
  // querySelector に入れる文字列を人が決める形にはしないこと。
  const answerOf = (question) =>
    [...list.querySelectorAll("input[type=radio]")].find((radio) => radio.dataset.question === question.id && radio.checked)?.value ?? "";

  document.getElementById("send").addEventListener("click", async () => {
    const missing = questions.filter((question) => answerOf(question) === "");
    if (missing.length > 0) {
      say.textContent = `${missing.length} 問、まだ選んでいません。`;
      return;
    }
    // 送るのは文字列だけ。数値や真偽値が 1 つでも混ざると、そのキーが落ちるのではなく
    // メッセージ全体が回答でなくなり、not-a-submission として拒否されます。
    // 答えは 1 つの text に詰めます — createFields は宣言なので、設問が増えるたびに
    // app.json を書き換えて publish し直す形にしないためです。詰め方は JSON（下）。
    const result = await view.submit("responses", {
      name: document.getElementById("who").value.trim(),
      comment: document.getElementById("comment").value.trim(),
      // JSON にします。区切り文字（タブでも改行でも）は、設問文にも選択肢にもそれが
      // 入り得る以上いつか必ず壊れます — 「とても<TAB>良い」という選択肢 1 つで、
      // 集計はそれを別の値として数え始めます。
      answers: JSON.stringify(Object.fromEntries(questions.map((question) => [question.id, answerOf(question)]))),
    });
    // 失敗は「壊れた」ではありません。サインインしていないか、この人が既に答えたか
    // （idFrom: "auth.uid"）のどちらかです。
    // そして "cancelled" は失敗ですらありません — 確認ダイアログで「やめる」を押した人に
    // 「送れませんでした」と出すのは嘘です。ok を先に読み、cancelled を残りと分けます。
    if (result.ok) {
      say.textContent = "ありがとうございました。";
    } else {
      say.textContent = result.error === "cancelled" ? "" : `送れませんでした: ${result.error ?? "unknown"}`;
    }
  });

  view.ready();
</script>
```

### views/desk.html

`audience: "member"`、入口は `/m/{slug}`。**ロールを持つ人だけ**が読めるドキュメントに publish
されます。**著者の Mac が閉じていても、スマホから結果が読める** — これがこのページの目的で、
コレクションペインでは代わりになりません。

契約は公開ページと同じ（`window.__MC_APP_VIEW` / `onState` / `ready`）。渡されるものだけが違い、
`collections` に書いたものが**その人の資格情報で**読まれます。

集計は**ここで数えるもの**で、どこにも保存しません。保存した集計は、行が 1 件増えるたびに嘘に
なります。

**設問を直せることの代償がここに出ます。** 選択肢の文言を変える・減らす、設問ごと消す — どれも
publish なしでできるので、集計を「いま宣言されているもの」だけで描くと、**それ以前の回答が黙って
消えます**。0 件と表示されるのではなく、その行（設問を消したなら、その設問の集計まるごと）が
出なくなる。下のページは**保存されている答えの側からも**選択肢と設問 id を集め、回ってこなく
なったものを「現在は選べません」「削除された設問」として残します。

**集計を描くときは、常に宣言と保存の和を取ること。** 片方だけを信じたページは、壊れずに数字を
減らします。そして回答が付いたあとに設問を直すときは、著者にこれを言ってください — **別物に
なった設問は、文言を書き換えるのではなく新しい `id` で足すほうが安全です。**

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 265;                                    /* indigo - answers, and nothing to run out of */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); color: var(--ink); color-scheme: light; }
  body { margin: 0 auto; max-width: 44rem; padding: 28px 18px 56px; font: 15px/1.65 system-ui, "Hiragino Sans", sans-serif; }
  h1 { margin: 0 0 18px; font-size: clamp(23px, 5vw, 31px); line-height: 1.2; letter-spacing: -.03em; }
  label { display: block; margin: 0 0 14px; color: var(--muted); font-size: 13px; font-weight: 750; }
  input:not([type="radio"]), textarea { display: block; width: min(22rem, 100%); margin-top: 6px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  input:focus, textarea:focus { border-color: var(--main); outline: 2px solid var(--line); }
  button { min-height: 38px; margin: 4px 6px 0 0; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--main); color: var(--paper); font: inherit; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  h2 { margin: 26px 0 10px; font-size: 17px; letter-spacing: -.02em; }
  #list fieldset { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #list legend { padding: 0 6px; font-weight: 780; }
  #list label { display: flex; align-items: center; gap: 9px; margin: 8px 0 0; color: var(--ink); font-size: 15px; font-weight: 400; cursor: pointer; }
  #tally > div, #comments > div { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say, #count { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<p id="count" role="status"></p>
<div id="tally"></div>
<h2>自由記述</h2>
<div id="comments"></div>
<script>
  const view = window.__MC_APP_VIEW;
  const tally = document.getElementById("tally");
  const comments = document.getElementById("comments");
  const count = document.getElementById("count");

  view.onState(({ questions = [], responses = [] }) => {
    count.textContent = `${responses.length} 件の回答`;

    // 回答は {設問 id: 選んだ文字列} の JSON。設問ごとに、選択肢ごとの件数を数えます。
    //
    // 読めないものは**黙って捨てず、数えて出します**。answers はページが組み立てた文字列で
    // あって、ルールが形を見てくれるものではないので（下の「数えているのは、人が書いた
    // 文字列です」）、壊れた回答が 0 件に見えるのと 1 件あるのとでは意味が違います。
    const chosen = new Map();
    let unreadable = 0;
    for (const response of responses) {
      let answered = null;
      try {
        const parsed = JSON.parse(String(response.answers ?? ""));
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) answered = parsed;
      } catch {
        answered = null;
      }
      if (answered === null) {
        unreadable += 1;
        continue;
      }
      for (const [question, choice] of Object.entries(answered)) {
        if (typeof choice !== "string" || choice === "") continue;
        const perQuestion = chosen.get(question) ?? new Map();
        perQuestion.set(choice, (perQuestion.get(choice) ?? 0) + 1);
        chosen.set(question, perQuestion);
      }
    }
    if (unreadable > 0) count.textContent = `${responses.length} 件の回答（うち ${unreadable} 件は読めない形式）`;

    // 保存されている側にしか無い設問 id も後ろに足します。いま宣言されている設問だけを
    // 描くと、消した設問への回答が丸ごと見えなくなるからです。
    //
    // ただし**それが何なのかは、このページには分かりません**。消したあとの名残かもしれない
    // し、回答者が作った文字列かもしれない（answers は自由文で、ルールは中身を見ません —
    // 下の「数えているのは、人が書いた文字列です」）。だから消さずに数え、宣言された設問と
    // 同じ顔では出しません。
    const declaredQuestions = new Set(questions.map((question) => question.id));
    const unknownQuestions = [...chosen.keys()]
      .filter((id) => !declaredQuestions.has(id))
      .map((id) => ({ id, text: `${id}（宣言にない設問 ID）`, choices: "" }));

    tally.replaceChildren(
      ...questions
        .slice()
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .concat(unknownQuestions)
        .map((question) => {
          const box = document.createElement("div");
          const heading = document.createElement("p");
          heading.textContent = question.text ?? question.id;
          box.append(heading);
          const perQuestion = chosen.get(question.id) ?? new Map();
          const declared = String(question.choices ?? "").split("\n").filter((line) => line.trim() !== "");
          // 宣言されている選択肢と、実際に保存されている答えの**和**を出します。設問は publish
          // なしで直せるので、選択肢の文言を変えたり消したりしたあとに現在の choices だけを
          // 見ると、それ以前の回答が集計から黙って消えます（0 件になるのではなく、行ごと
          // 出なくなる）。回ってこなくなった答えは、残しつつそれと分かるようにします。
          const unknown = [...perQuestion.keys()].filter((choice) => !declared.includes(choice));
          for (const choice of [...declared, ...unknown]) {
            const n = perQuestion.get(choice) ?? 0;
            const row = document.createElement("div");
            const label = document.createElement("span");
            // 宣言に無い値は、消された選択肢の名残とも、回答者が作った文字列とも区別が
            // つきません。両方あり得ると分かる言い方にすること。
            label.textContent = unknown.includes(choice) ? `${choice}（宣言にない値）: ${n} 件` : `${choice}: ${n} 件`;
            const bar = document.createElement("div");
            // 幅はスタイルで持たせること。棒を文字で描くと、数が増えたときに折り返します。
            bar.style.width = `${responses.length === 0 ? 0 : Math.round((n / responses.length) * 100)}%`;
            bar.style.height = "8px";
            bar.style.background = "#4f46e5";
            row.append(label, bar);
            box.append(row);
          }
          return box;
        }),
    );

    // answeredAt はサーバが入れた "…Z" の文字列。辞書順が時刻順なので、そのまま比較します。
    comments.replaceChildren(
      ...responses
        .filter((response) => String(response.comment ?? "").trim() !== "")
        .sort((a, b) => String(b.answeredAt ?? "").localeCompare(String(a.answeredAt ?? "")))
        .map((response) => {
          const box = document.createElement("div");
          const who = document.createElement("span");
          who.textContent = `${response.name ?? ""}（${response.email ?? ""}）`;
          const what = document.createElement("p");
          what.textContent = response.comment ?? "";
          box.append(who, what);
          return box;
        }),
    );
  });

  view.ready();
</script>
```

### 数えているのは、人が書いた文字列です

`answers` は自由文で、**ルールはその中身を見ません。** 中身が JSON であることすら保証されない
（読めなかった件数を上のページが出しているのはそのためです）。 公開の書き込みでルールが値そのものを
確かめるのは 2 つだけ — `statusField` が `initialStatus` と一致すること、`emailField` が
サインインした本人のアドレスであること。それ以外は `createFields` に**名前がある**かどうかだけ
で、中身は送られたとおりに入ります。ページを開いた人が radio の `value` を書き換えることも、
ブリッジを直接呼ぶこともできるので、**宣言にない設問 ID や選択肢の入った回答は作れます**。

だから:

- **上の集計は「宣言にない値」を消しません。** 消すと、正当に消された選択肢への過去の回答まで
  一緒に消えるからです。**そして同じ理由で、それを「削除された設問」と断定もしません** —
  ページにはその 2 つが区別できない。件数とともに、宣言に無いものとして出すのが正直な形です。
- **本物の検証が要るなら、集計の側ではなく形の側で。** 1 設問 1 フィールドにして
  `createFields` に並べれば、少なくとも**未知のキーは拒否されます**（`hasOnly`）。値そのものは
  それでもルールを通り抜けるので、`enum` から外れた値は**受け取ったあとにコレクションのペインで
  弾く**ことになります。
- **公開の集計にそのまま出さないこと。** ここは `member` のページで、読むのは名簿の人です。
  同じ数字を誰でも見えるところに出すなら、それは投票所を作っているのと同じで、この
  テンプレートの形では守れません。

---

## この形が向かないもの

- **枠や定員があるもの** — 先着なら `gym.md`、1 つのものを取り合うなら `meeting-room.md`。
  このテンプレートには排他が無く、`idFrom: "auth.uid"` が防ぐのは「同じ人の 2 件目」だけです。
- **誰かが承認するもの** — 応募を受けて可否を返すなら `salon.md` の `assignee`。ここの
  `status` は「読んだ」を記録するだけで、`transitions` を書いていないので誰も動かせません。
- **匿名で集めたいもの** — `auth: "verifiedEmail"` は住所を記録します。`auth: "none"` にすると
  誰でも書けるようになり、そのとき `idFrom: "auth.uid"` の 1 人 1 件も効きません。**匿名と
  重複防止は同時に成り立ちません** — どちらが要るかをユーザーに決めてもらってください。
