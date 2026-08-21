# テンプレート: 予約と承認（美容室）

**いつ使うか** — 申込みを受けて、**担当者が自分の分だけ承認する**アプリ。美容室の予約、
面談の申込み、修理の受付、査読の割り当て。「誰が担当か」で権限が変わるものはこの形。

要点は 2 つあります。

**`assignee` ロール。** 担当者は**全予約を見て、自分の担当だけ書き換えられる**。受付は
全予約を書き換えられる。この 2 つを同時に表現できるのは、絞りがコレクションではなく
**名簿の側**にあるからです。

**枠（`slots`）を実在させ、予約の id を枠の id にする。** これで「同じ枠を 2 人が取る」が
起きなくなります。2 人目の書き込みは**既に在るドキュメントへの書き込み**になり、公開の
申込み経路は create しか許していないので拒否される。ジム（[gym.md](./gym.md)）の
先着順とは違う仕組みで、あちらは「数えられないので順位で見せる」、こちらは
**数える必要がない**（枠は 1 行）。

---

## app.json

```json
{
  "aid": "(init が書きます。手で触らないこと)",
  "name": "さくら美容室",
  "slug": "sakura-hair",
  "protocol": "1.0.0",
  "members": {
    "owner@salon.jp": { "*": "owner" },
    "reception@salon.jp": { "bookings": "editor", "slots": "editor", "services": "viewer" },
    "anna@salon.jp": { "bookings": "assignee", "slots": "viewer", "services": "viewer" },
    "ben@salon.jp": { "bookings": "assignee", "slots": "viewer", "services": "viewer" }
  },
  "collections": {
    "bookings": {
      "submitOnly": true,
      "assigneeField": "stylistEmail",
      "statusField": "status",
      "transitions": {
        "initial": ["pending"],
        "pending": ["approved", "rejected"],
        "approved": ["cancelled"]
      },
      "mail": {
        "toField": "customerEmail",
        "on": { "booking-approved": { "from": ["pending"], "to": "approved" } }
      }
    },
    "slots": { "mirrorOf": "bookings" }
  },
  "views": [
    { "id": "public", "audience": "public", "path": "views/booking.html", "collections": ["stylists", "services", "slots"] },
    { "id": "desk", "audience": "member", "path": "views/desk.html", "collections": ["bookings", "slots"] },
    { "id": "mine", "audience": "participant", "path": "views/mine.html", "collections": ["bookings"] }
  ],
  "public": {
    "enabled": true,
    "read": ["services", "stylists", "slots"],
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "emailField": "customerEmail",
        "createFields": ["customerName", "customerEmail", "service", "slot", "status"],
        "initialStatus": "pending",
        "idFrom": "field",
        "idField": "slot",
        "idIn": { "collection": "slots", "where": { "field": "state", "equals": "open" } },
        "mirror": "slots",
        "window": {
          "fromField": { "ref": "slot", "collection": "slots", "field": "opensAt" },
          "untilField": { "ref": "slot", "collection": "slots", "field": "closesAt" }
        },
        "selfUpdate": { "pending": ["service"] },
        "selfTransitions": { "pending": ["cancelled"] }
      }
    }
  }
}
```

**`protocol` は publish 契約の版**です。宣言は**下限**で、publish される値ではありません
（文書が守るのは、それを射影した compiler の版）。宣言より古い publisher は**拒否**されるので、
新しい書き方に頼ったアプリが、それを実装していない publisher に黙って通ることがありません。
何も宣言しないアプリは `1.0.0` — このキーが無かった頃に publish されたアプリはそれです。

**申込みの宣言は丸ごと書いてください。** `idFrom` と `idField` だけを書いた短い版は
**publish が拒否します**（`idIn` が無ければ、実在しない枠の予約が黙って通るので）。
省略が効くところではありません。

## .claude/skills/bookings/schema.json

```json
{
  "title": "予約",
  "icon": "event",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "customerName": { "type": "string", "label": "お名前", "required": true },
    "customerEmail": { "type": "email", "label": "メール", "required": true },
    "service": { "type": "enum", "label": "メニュー", "values": ["カット", "カラー", "パーマ"], "required": true },
    "slot": { "type": "string", "label": "枠", "required": true },
    "stylistEmail": { "type": "email", "label": "担当（アドレス）" },
    "stylist": { "type": "ref", "label": "担当", "to": "stylists" },
    "status": { "type": "enum", "label": "状態", "values": ["pending", "approved", "rejected", "cancelled"] }
  }
}
```

## .claude/skills/slots/schema.json

```json
{
  "title": "枠",
  "icon": "schedule",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "stylist": { "type": "ref", "label": "担当", "to": "stylists" },
    "startAt": { "type": "datetime", "label": "開始", "required": true },
    "opensAt": { "type": "number", "label": "受付開始（epoch millis）", "required": true },
    "closesAt": { "type": "number", "label": "受付締切（epoch millis）", "required": true },
    "state": { "type": "enum", "label": "状態", "values": ["open", "taken"], "required": true }
  }
}
```

**主キーは合成スラッグ**にします（`anna-2026-09-01-1000` のような）。予約の id が
この id になるので、読める形にしておくと運用が楽です。

`opensAt` / `closesAt` は **epoch millis の数値**で、枠を作るときに計算して入れます。
ルールに日付の計算はできず `request.time` は UTC なので、「3 日前の朝 7 時」のような
決め方をするのは枠を作る側の仕事です。ルールは**比べるだけ**。

`state` は予約と**同じ書き込みで**動きます（下記）。手で書き換えるものではありません。

`stylists` / `services` は普通のコレクション（`storage: {"type":"firestore"}` だけ足す）。
担当者一覧、メニューと所要時間です。

## views/booking.html

**リポジトリの root から見た `views/` に置きます**（`app.json` と同じ場所を起点に、
`views/<name>.html` の 1 枚だけ）。ホスト側のカスタムビューとは**別の契約**です —
`__MC_VIEW` を読むビューをここに指すと publish が拒否します。

**`prompt` / `alert` / `confirm` は動きません** — ビューは `sandbox="allow-scripts"` の中で、
`allow-modals` が無い呼び出しは無視されます（コンソールに `Ignored call to 'prompt()'.` と
出るだけ）。訊くのはページの中の `<input>`、報せるのはページの中の要素です。

**`<form>` も使えません。** `allow-forms` が無いので、ブラウザは `submit` イベントを**発火する
前に**送信ごと止めます — `onsubmit` の中の `e.preventDefault()` すら走らないので、「押しても
何も起きないボタン」になります（コンソールに `Blocked form submission to ''` と出るだけ）。
テキスト入力での Enter も、`required` の検証も同じ理由で効きません。`<form>` は使わず、`<div>` と
`type="button"` のボタンにして、**click** で送信し、入力チェックは自分で書きます。

The colours below all come from one `--hue`, and **it is meant to be changed** — this one is
this template's, not your app's. The rules behind the sheet, and how to go further than these
fifteen lines, are in [design.md](./design.md).

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 330;                                    /* plum - an appointment somebody approves */
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
  ul { margin: 0; padding: 0; list-style: none; }
  #grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  #rows > div, #today li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<label>お名前 <input id="who" maxlength="40" /></label>
<p id="say" role="status"></p>
<div id="grid"></div>
<script>
  const view = window.__MC_APP_VIEW;
  const grid = document.getElementById("grid");
  const who = document.getElementById("who");
  const say = document.getElementById("say");
  view.onState(({ stylists = [], slots = [] }) => {
    // textContent と dataset で組み立てること。レコードの値（担当者名、メニュー名）は
    // 人が入力するもので、文字列連結で innerHTML に入れると公開ページでそれが動きます。
    grid.replaceChildren(
      ...slots
        .filter((slot) => slot.state === "open")
        .map((slot) => {
          const button = document.createElement("button");
          // type を書くこと。省略した <button> は submit ボタンで、サンドボックスが
          // 送信を止める側の形です。
          button.type = "button";
          button.dataset.slot = slot.id;
          button.textContent = `${slot.startAt} ${slot.stylist ?? ""}`;
          return button;
        }),
    );
  });
  grid.addEventListener("click", async (event) => {
    const slot = event.target.dataset?.slot;
    if (!slot) return;
    const customerName = who.value.trim();
    if (customerName === "") {
      say.textContent = "お名前を入れてください。";
      who.focus();
      return;
    }
    const result = await view.submit("bookings", { slot, customerName, status: "pending" });
    // 失敗の理由は二重予約とは限りません（締切、サインイン、必須項目）。そして
    // "cancelled" は失敗ではありません — 確認ダイアログで「やめる」を押しただけです。
    if (result.ok) {
      say.textContent = "受け付けました。";
    } else if (result.error === "cancelled") {
      say.textContent = "";
    } else {
      say.textContent = result.error ? `予約できませんでした: ${result.error}` : "その枠は取られました。";
    }
  });
  view.ready();
</script>
```

3 つだけ守れば形は自由です。

- **`ready()` を最後に呼ぶ。** これが「listener を張り終えた」の合図で、親はこれを
  待ってからデータを送ります。呼ばないとデータは永久に来ません
- **`submit()` の結果を見る。** 「その枠は取られました」を出せるのはここだけです。
  親が書き込みを行い、ルールが判断し、答えが返ってきます
- **送るのは文字列だけ。** `values` に数値や真偽値が 1 つでも混ざると、そのキーが落ちるの
  ではなく**メッセージ全体が申込みでなくなり**、`not-a-submission` として拒否されます
- **`customerEmail` は送らない。** サインインした訪問者のアドレスを親が入れます
  （ルールがトークンと突き合わせるので、入力欄にすると間違えられるだけの欄になります）

**publish の前に、プレビューで実際に押してもらってください** — Collections ペインの
「Preview the shared app」で、`/a/{slug}` と**同じ親・同じサンドボックス**のままこのページが
動きます（[SKILL.md](../SKILL.md) の「3. RUN THE PAGE」）。ここの不具合は読んでも見つからず、
押すと確認ダイアログが出るところまで見て初めて分かります。

**押した瞬間には書き込まれません。** 親が送られてきた値を iframe の外に描いて確認を
取り、訪問者が押してから書きます。これはビューの HTML が信頼されていないためで、
読み込んだ瞬間に `submit()` を呼ぶページがあっても、勝手に予約が入ることはありません。

## views/desk.html — 受付の画面

`audience: "member"` のページです。**ロールを持つ人だけ**が読めるドキュメントに publish され、
入口は `/m/{slug}`。店主の Mac が閉じたままでも、受付とスタイリストが自分のスマホで
その日の予約を見られる、というのがこれの目的です。

契約は公開ビューと**同じ**（`window.__MC_APP_VIEW` / `onState` / `ready`）。違うのは
渡されるものだけで、`collections` に書いたものが**その人の資格情報で**読まれます。

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 330;                                    /* plum - an appointment somebody approves */
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
  ul { margin: 0; padding: 0; list-style: none; }
  #grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  #rows > div, #today li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<ul id="today"></ul>
<script>
  const view = window.__MC_APP_VIEW;
  const today = document.getElementById("today");
  view.onState(({ bookings = [] }) => {
    today.replaceChildren(
      ...bookings.map((booking) => {
        const row = document.createElement("li");
        row.textContent = `${booking.startAt ?? booking.slot} ${booking.customerName} — ${booking.status}`;
        return row;
      }),
    );
  });
  view.ready();
</script>
```

**ここに渡るのは公開データではありません。** 公開ビューは「誰でも取れるデータしか
渡さない」と言えましたが、この画面が受け取るのは氏名と連絡先を含む予約そのものです。
書くのはオーナー、データもオーナーのもの、読むのはオーナーの名簿にいる人 — なので
プラットフォームはこれを止めませんが、**そういうものを書いている**ことは知っておいてください。

### 承認と、担当の付け替え

この画面からできます。呼べるのは 2 つで、**どちらもフィールド名を名乗れません**:

```js
await view.transition("bookings", booking.id, "approved");  // 承認・却下
await view.assign("bookings", booking.id, "stylist@salon.jp");  // 担当の付け替え
```

どちらも `{ ok, error }` を返します。

- **動くのは 1 フィールドだけ。** `transition` は `statusField`、`assign` は
  `assigneeField`。どのフィールドかを決めるのは宣言で、ページではありません
- **遷移は宣言どおりにしか動きません。** `collections.bookings.transitions` に無い移動は
  拒否され、理由が返ります。参加者のページ（`views/mine.html`）には**別の表**
  （`selfTransitions`）が渡るので、同じコレクションでも描けるボタンが違います
- **承認メールは同じ書き込みに入ります。** `collections.bookings.mail` に
  その遷移のテンプレートがあれば、レコードと 1 回で書かれます。宛先もテンプレートも
  レコードと遷移から決まるので、却下した予約に「承認しました」を送ることはできません
- **確認ダイアログは出ません**（公開の `submit` とはここが違います）。押した人は
  この店の名簿にいて、自分の仕事をしているためです。代わりに、**何が起きたかは
  iframe の外に親が必ず出します** — ページが何を描くかとは無関係に

### 誰がそのボタンを押せるか

`/m/{slug}` に入れるのは**どこかにロールを 1 つ持っている人**なので、`viewer` も、
別のコレクションだけに editor を持つ人も、受付と同じページを開けます。
**入れることは権限ではありません。**

そこで `onState` の**第 2 引数**に、読み手が誰で、実際に何ができるかが渡ります:

```js
view.onState((data, viewer) => {
  const desk = viewer.can.bookings ?? {};
  // desk.transitionAny  全部の行を承認できる（owner / editor）
  // desk.transitionOwn  自分に割り当てられた行だけ（assignee）
  // desk.assigneeField  行の担当者アドレスが入っているフィールド名
  // desk.assign         付け替えられる
  // desk.assignees      付け替え先の候補
  // viewer.me           この読み手自身のアドレス
  const 押せる = (行) => desk.transitionAny || (desk.transitionOwn && 行[desk.assigneeField] === viewer.me);
});
```

`transitionOwn` だけでは**どの行か**が分かりません。だから `me` と `assigneeField` が
一緒に来ます — 全行にボタンを出す（大半が拒否される）か 1 つも出さないか、
のどちらかしかなくなるためです。

**ロール名は渡りません。** ページが `"editor"` で分岐するのは、誰もレビューしない
場所にルールをもう一度書くことになるためです。描くのは渡された能力のとおりに。

親は同じ判定を**押されたときにもう一度**行うので、これを無視したページは
拒否されるだけです（`not-permitted`）。`assignee` は他人の行を動かせず、
**自分の行も渡せません**（ルールが前後の両方で本人を要求するため）。

## views/mine.html — 予約した人の画面

`audience: "participant"`。入口は **`/p/{slug}`** で、公開ページの下にリンクがあります。
自分の行しか読めないので `collections` に書けるのは `bookings` だけ、渡るのも自分の予約だけです。

キャンセルは同じ `transition` で、**表が違うだけ**です（本人に許されている遷移は
`public.submit.bookings.selfTransitions`、スタッフのそれは `collections.bookings.transitions`）。

```html
<style>
  /* Every colour is derived from ONE hue — the rules are in design.md. Change it for your app. */
  :root {
    --hue: 330;                                    /* plum - an appointment somebody approves */
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
  ul { margin: 0; padding: 0; list-style: none; }
  #grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  #rows > div, #today li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 14px; background: var(--fill); }
  #say { min-height: 1.6em; margin: 14px 0 0; color: var(--main); font-size: 13px; font-weight: 700; }
</style>
<div id="rows"></div>
<p id="say" role="status"></p>
<script>
  const view = window.__MC_APP_VIEW;
  const rows = document.getElementById("rows");
  const say = document.getElementById("say");

  view.onState(({ bookings = [] }) => {
    const mine = bookings.slice().sort((a, b) => String(a.slot ?? "").localeCompare(String(b.slot ?? "")));
    rows.replaceChildren(
      ...mine.map((booking) => {
        const row = document.createElement("div");
        const what = document.createElement("span");
        // textContent。担当者名もメニュー名も人が入力するものです。
        what.textContent = `${booking.slot ?? ""} ${booking.service ?? ""} — ${booking.status ?? ""}`;
        row.appendChild(what);
        // `selfTransitions` は pending からの cancelled だけ。approved を取り消せるのは
        // 受付（`collections.bookings.transitions`）なので、ここに出すと必ず断られる
        // ボタンになります。宣言に無い遷移は描かないこと。
        if (booking.status === "pending") {
          const off = document.createElement("button");
          // type を書くこと。省略した <button> は submit ボタンで、サンドボックスが
          // 送信を止める側の形です。
          off.type = "button";
          off.dataset.booking = booking.id;
          off.textContent = "キャンセル";
          row.appendChild(off);
        }
        return row;
      }),
    );
    if (mine.length === 0) rows.textContent = "予約はありません。";
  });

  rows.addEventListener("click", async (event) => {
    const button = event.target;
    const id = button.dataset?.booking;
    if (!id) return;
    // 確認はページの中で 2 度押しにします。confirm() はサンドボックスに無視され、
    // false が返るので「押しても何も起きないボタン」になります。
    if (button.dataset.armed !== "yes") {
      button.dataset.armed = "yes";
      button.textContent = "取り消す？";
      return;
    }
    const result = await view.transition("bookings", id, "cancelled");
    say.textContent = result.ok ? "取り消しました。" : `取り消せませんでした: ${result.error ?? "unknown"}`;
  });

  view.ready();
</script>
```

---

## 利用者に先に言っておくこと

- **公開されるのは `slots` だけ**で、予約そのもの（氏名・メール）は公開されません。
  Firestore の読み取りはドキュメント単位でフィールドを隠せないので、これは運用の
  注意ではなく**構造**で守っています。`bookings` を `public.read` に足すと、その瞬間に
  客の連絡先が匿名の訪問者から全部読めます
- **枠は先着で本当に排他されます。** ジムの順位方式と違い、繰り上げは起きません
- **顧客がキャンセルしても枠はすぐには空きません。** 受付が戻す操作が要ります（下記）

---

## なぜこの形か — 迷いやすい 7 点

### 1. 担当は `stylistEmail`（アドレス）で、`stylist`（ref）ではない

ルールが比較できるのは `request.auth.token.email` だけです。`ref` が保存しているのは
**参照先の主キー slug**（`anna`）であってアドレスではないので、`assigneeField` に ref を
指定すると誰にも一致しません。`check` が拒否します。

**両方持つのが正解**です。`stylist`（ref）は画面に出す用、`stylistEmail` は権限用。
`stylists` コレクションの主キーをアドレスにすれば 1 本で済みますが、公開ページに
スタッフのアドレスが出るので勧めません。

### 2. 担当を割り当てるのは受付（editor）で、客ではない

`createFields` に `stylistEmail` を入れれば「客が担当を指名する」形にできますが、
それは**客が「誰にこの行の権限が渡るか」を決める**ということです。予約アプリとしては
自然な要求なので禁止はしていませんが、意図してやるときだけにしてください。

初期状態では `stylistEmail` が空で、受付が入れるまで誰の担当でもありません。
その間 pending の予約を承認できるのはオーナーと受付だけです。

### 3. `submitOnly: true` を外せない — その代わりスタッフの代理入力ができない

`emailField` を宣言した時点で、そのレコードは「この人が申し込んだ」という意味を持ちます。
`submitOnly` はそれを守るもので、**publish が要求します**（無いと owner / editor が誰の
名前でもレコードを作れてしまう）。

代償として、**電話予約をスタッフが代わりに入力することはできません**。どうしても必要なら
`emailField` を外すことになり、そのとき失うのは「マイ予約」ページ（客が自分の予約を見て
キャンセル・変更する）です。どちらを取るかは店の判断で、コードの都合ではありません。

### 4. 承認は状態機械が縛る — 担当者も例外ではない

`transitions` は writer 経路にも効きます。`cancelled` の予約をいきなり `approved` に
飛ばすことは、受付にもオーナーにもできません。`approved` になれるのは `pending` からだけ。

### 5. 承認メールは担当者も出せる、ただし自分の担当の分だけ

`mail` は「宣言した遷移が実際に起きたとき」にだけ積めます。宛先も本文もレコードから
再導出されるので、担当者が選べるのは**どのレコードか**だけで、そこにも同じ絞りが
かかっています。

### 6. 枠は予約と**同じ書き込みで**取られる

予約が作られるとき、`slots` のその行の `state` も同じ batch で `taken` になります。
ルールが**両側から**要求するので、片方だけの書き込みは通りません:

- 鏡を連れない予約の create は拒否される（＝予約は成立しているのに公開ページが
  「空き」と言い続ける、が起きない）
- `state` に書ける値は**真実だけ**です。予約が在れば `taken`、無ければ `open`。
  嘘は書けないので、この 1 フィールドは**誰でも**書けます

最後の点が効くのは、**先を越された 2 人目**です。その人は「取られていた」と知った
唯一の人なので、拒否のあと自分で `taken` に直せます。格子はそこで正しくなります。

公開ページの表示は**遅れることがあります**（鏡は写しなので）。ただし遅れる方向は常に
「空きと言っているが実は埋まっている」で、その先には id の衝突による拒否が必ず待って
います。**見た目が遅れるだけで、二重予約は起きません。**

### 7. キャンセルは 2 段階 — 客の操作では枠は空かない

| 誰が | どうやって | 枠は |
|---|---|---|
| 顧客 | `selfTransitions` で `status: "cancelled"` | **空かない**（ドキュメントが残り id を占有し続ける） |
| 受付・担当 | 予約を delete（`slots` を `open` に戻す書き込みと対で） | 空く |

このテンプレートでは顧客に delete を許していません。**これは制約であると同時に、たぶん
正しい運用でもあります** — 枠が客の操作で即座に他人に開く必要はなく、受付が確認してから
戻す方が店の実態に合う。承認メール（`booking-approved`）を出せるのも、行が残るからです。
ただし**そう決めたことを利用者に言ってください**。「キャンセルしたのに枠が空かない」は、
書いていなければバグに見えます。

**押したその場で枠を開けたい店は** `public.submit.bookings.selfDelete` に状態を挙げます
（会議室のテンプレート [meeting-room.md](./meeting-room.md) がその形）。代償は行が消える
ことで、履歴も残らず、その取り消しにメールも束ねられません。美容室で勧めないのはそのため
です。

---

## 担当者に何ができて、何ができないか

| | オーナー | 受付 (editor) | 担当 (assignee) |
|---|---|---|---|
| 全予約を**読む** | できる | できる | **できる**（当日の全体が見えないと働けない） |
| 自分の担当を承認 | できる | できる | **できる** |
| 他人の担当を承認 | できる | できる | **できない** |
| 担当を付け替える | できる | できる | **できない**（自分に付け替えて奪うのも、他人に投げるのも） |
| 予約を消す | できる | できる | 自分の担当だけ |
| 枠・メニューを編集 | できる | **枠は編集できる**（受付が枠を作り、戻す） | 読むだけ |
| publish | **できる** | できない | できない |

`assignee` は**コレクションを名指しして**与えます。`{"*": "assignee"}` は拒否されます —
「自分の行」が何を指すかはコレクションごとに違うためです。

---

## 作る順番

1. `init`（`slug` に店の名前）
2. `stylists` / `services` / `slots` / `bookings` のスキル + スキーマを書く
3. `views/booking.html` を書く（**リポジトリの root から** `views/`。スタイリスト × 時間の
   格子。埋まっている枠は選べない）
4. `check` — ここで `assigneeField` の型、ロールの過不足、鏡の片側落ち、ビューが読むと
   宣言したコレクションが `public.read` に無いこと、が出ます
5. `preview` でページを実際に走らせ、`publish` → 名簿の人に URL を渡す（`public` を宣言して
   いなければ、これで公開はされません）
6. スタッフを `invite`（担当者は `role: "assignee"` と `cid: "bookings"`）
7. 枠を作る（`opensAt` / `closesAt` / `state: "open"` を入れて `slots` に流し込む）
8. 客に開くのは `public` を宣言して `publish` し直したときだけ

**排他に関わるキーは、レコードが 1 行でもあると変えられません**（`idFrom` / `idField` /
`idIn` / `mirror` / `mirrorOf`）。publish が拒否し、`confirm` でも通りません — 変えると
過去の予約が「押さえていたはずの枠」を押さえなくなり、しかも**誰にも見えない**ためです。
やり直すなら、コレクションを空にするか新しい cid で作ります。7 の前に 3〜4 を済ませる
順番はそのためです。

参照: [SKILL.md](../SKILL.md) の「公開するとき」、先着順の申込みは
[gym.md](./gym.md)。
