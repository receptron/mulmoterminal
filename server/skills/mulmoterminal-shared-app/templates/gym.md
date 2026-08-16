# テンプレート: 先着枠と待機（ジムのクラス予約）

**いつ使うか** — 定員があり、**決まった時刻に申込みが開き**、先着で埋まるもの。ジムの
クラス、ワークショップ、面談枠、席の予約。

**最初に利用者へ言うこと**が 2 つあります。作ってから言うのでは遅い:

- **繰り上がりの通知は飛びません。** 画面を開けば「繰り上がりました」と出せますが、
  メールは出せません（下の「繰り上げ」参照）。
- **順位を見るには、参加者が互いの申込みを読める必要があります。** 名前が並んで見えても
  よいか、先に確認してください。

---

## 中心にある考え方 — 定員は「状態」ではなく「順位」

**セキュリティルールは件数を数えられません。** クエリも集計も書けないので、「残り 1 枠」を
サーバ側で守る宣言はどう書いても作れません。

そこで**定員を保存せず、申込み順の順位から導きます**。

- 申込みを `createdAt` 昇順に並べ、**1〜8 番目が確定、9〜10 番目が待機**、それ以降は待機 3…
- **3 番目がキャンセルすると、9 番目は書き込みゼロで 8 番目になります。** 繰り上げという
  操作が自動になるのではなく、**存在しなくなる**。
- 8 時ちょうどに 30 人が殺到しても、全員が自分のドキュメントを 1 件書くだけ。奪い合う
  カウンタが無いので競合しません。溢れても壊れず、11 人目は「待機 3 番」になるだけです。

これを成立させているのが `stampField`（順位を偽装させない）と、表示側の view です。

---

## app.json

```json
{
  "aid": "(init が書きます)",
  "name": "スタジオみどり",
  "slug": "studio-midori",
  "members": {
    "owner@gym.jp": { "*": "owner" },
    "desk@gym.jp": { "bookings": "editor", "classes": "editor" }
  },
  "collections": {
    "bookings": {
      "submitOnly": true,
      "statusField": "status",
      "peerVisibility": "public",
      "transitions": { "initial": ["requested"], "requested": ["cancelled"] }
    }
  },
  "public": {
    "enabled": true,
    "read": ["classes"],
    "submit": {
      "bookings": {
        "auth": "verifiedEmail",
        "emailField": "memberEmail",
        "idFrom": "auth.uid+field",
        "idField": "classId",
        "stampField": "createdAt",
        "initialStatus": "requested",
        "createFields": ["classId", "memberEmail", "memberName", "createdAt", "status"],
        "selfTransitions": { "requested": ["cancelled"] },
        "window": { "fromField": { "ref": "classId", "collection": "classes", "field": "opensAt" } }
      }
    }
  },
  "views": [
    { "id": "public", "audience": "public", "path": "views/signup.html", "collections": ["classes"] },
    { "id": "mine", "audience": "participant", "path": "views/mine.html", "collections": ["classes", "bookings"] }
  ]
}
```

**`views` は省けません。順位は生成フォームには出せません** — フォームは 1 件書くだけで、
何番目かを知らないからです。そして**順位のページは公開ページではありません**:

- **公開の `views/signup.html`** が読めるのは `public.read` にあるものだけ、つまり `classes` です。
  `bookings` をここの `collections` に書くと publish が拒否します（訪問者の権限で読むので、
  ルールが拒否して**空のページが描かれる** — 一番たちの悪い壊れ方だからです）。
- **順位は `audience: "participant"` の `views/mine.html`**、入口は `/p/{slug}`。ここで初めて
  他の人の申込みが読め、`peerVisibility: "public"` がそれを許しています。**名簿に載っている
  人どうしで名前が見える**ということなので、作る前に利用者へ確認してください（下の表）。

## .claude/skills/classes/schema.json

```json
{
  "title": "クラス",
  "icon": "fitness_center",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "title": { "type": "string", "label": "クラス名", "required": true },
    "startsAt": { "type": "datetime", "label": "開始", "required": true },
    "opensAt": { "type": "number", "label": "申込み解禁（epoch millis）", "required": true },
    "capacity": { "type": "number", "label": "定員" },
    "waitlist": { "type": "number", "label": "待機の上限" }
  }
}
```

## .claude/skills/bookings/schema.json

```json
{
  "title": "申込み",
  "icon": "how_to_reg",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "classId": { "type": "string", "label": "クラス", "required": true },
    "memberName": { "type": "string", "label": "お名前", "required": true },
    "memberEmail": { "type": "email", "label": "メール", "required": true },
    "createdAt": { "type": "datetime", "label": "申込日時", "required": true },
    "status": { "type": "enum", "label": "状態", "values": ["requested", "cancelled"] }
  }
}
```

---

## 効いている宣言 5 つ

### `stampField: "createdAt"` — 列に割り込ませない

レコードが**サーバの時刻**を持っていることを create で強制し、以後変更させません。

順位が定員の代わりになる以上、順位の元になる時刻が偽装できると全部が崩れます。
`idFrom` は二重申込みを防ぎますが、**昨日の日付を書いて先頭に並ぶ**のは防ぎません。
スタッフ（editor）にも同じ制約がかかるので、受付が友人を先頭に入れることもできません。

**`createFields` に入れる必要があります**（ルールはリスト外のキーを拒否するため）。
ただし**入力欄としては描かれません** — 公開フォームの射影がこの名前を
`stampField` として別に伝えるので、ページはサーバ時刻のセンチネルを入れます。

センチネルを入れるのはホスト側で、**ページは関与しません**。ビューが `submit` に載せられるのは
文字列だけで、文字列の日時は `== request.time` を満たさないので、ここは書けないのが正しい。

（2026-08-14 まで、そのセンチネルを入れる側がどのホストにも無く、この形の公開申込みは全部
拒否されていました。`@receptron/sharedapp` 0.5.0 と両ホストの取り込みで直っています。）

**ページが受け取る形は決まっています**: `2026-08-15T23:05:54.605987654Z` — UTC・小数 9 桁・
`Z` 固定の文字列です。保存されているのは Firestore の `Timestamp` ですが、両ホストが読みの
境界で必ずこの形に落とすので、ページに `Timestamp` が届くことはありません。

**辞書順がそのまま時刻順**なので、下の `ranked()` のように**素の文字列比較で並べれば正しい**。
`new Date(...)` に通してはいけません — ミリ秒までしか残らないので、同じミリ秒に届いた 2 件が
同点になり、そこから先は読んだ順（ドキュメント ID 順）に戻ります。殺到したときにだけ壊れる、
いちばん見つけにくい形です。小数 9 桁まで一致した場合の決着はドキュメント ID 順で、
これはどのホストも `orderBy("__name__")` で読み、`sort` が安定であることから来ています。

（2026-08-15 まで、この値はページに `Timestamp` のまま渡っていました。`String()` が
`[object Object]` になるので比較は常に 0 を返し、**順位は時刻ではなくドキュメント ID の順**
でした。何もエラーは出ません。core の codec と両ホストの取り込みで直っています。）

キャンセルしても時刻は動きません（更新側は「値が動いていないこと」を見ます）。
動かす仕様にすると、離脱する列の最後尾に飛ばされてしまいます。

### `window.fromField` — クラスごとの解禁時刻

「3 日前の朝 8 時」は**レコードごと**の境界なので、コレクション全体に 1 個の
`window.from` では書けません。

**日付計算はルールにさせません。** `opensAt` に **epoch millis** を入れるのは
クラスを登録する側の仕事で（「3 日前の 8 時」は業務知識、しかもタイムゾーンが要る）、
ルールはそれを読んで `request.time` と比べるだけです。

```
opensAt = (クラスの開始日の 3 日前の 08:00 現地時間).getTime()
```

`collection` は宣言で固定されていて、申込み側から取るのは**ドキュメント ID だけ**です。
クラスが存在しない・`opensAt` が無い場合は、窓が開くのではなく**拒否**されます。

### `idFrom: "auth.uid+field"` + `idField: "classId"` — 1 人 1 枠

ドキュメント ID が `{uid}_{classId}` に固定されます。`allow create` は**存在しない
ドキュメントにしか適用されない**ので、2 回目の申込みはルールが自動で弾きます。
重複チェックのコードは要りません。

### `submitOnly: true` — 水増しを防ぐ

`emailField` で「この人が申し込んだ」という意味を持つレコードになるので、publish が
要求します。代償として**スタッフの代理入力はできません**。

### `selfTransitions` — 本人のキャンセル

`requested → cancelled` だけを本人に許します。キャンセルは delete ではなく状態にして
ください。**view が順位を詰めるときに除外**でき、誰がいつ抜けたかも残ります。

---

## ページは 2 枚書きます

**`signup.html`（公開）** は `classes` を並べて、申込みを 1 件 `submit()` するだけです。
順位はここには出せません（読めないので）。

**`mine.html`（participant）** が、読めた行から:

1. `status != "cancelled"` を `createdAt` 昇順に並べる
2. 先頭 `capacity` 件を「確定」、次の `waitlist` 件を「待機 N 番」、それ以降も待機として続ける
3. 自分の行を強調して「あなたは待機 1 番です」と出す

守る点はこの 3 つで、どれを破っても**例外が出ず、画面も変わりません**:

- **`<form>` は使えない。** `sandbox="allow-scripts"` に `allow-forms` が無いので、ブラウザは
  `submit` イベントを**発火する前に**送信を止めます。`onsubmit` の中の `e.preventDefault()` すら
  走らず、「押しても何も起きないボタン」になります。`<div>` と `type="button"` のボタンにして、
  **click** で `submit()` を呼びます。テキスト入力での Enter と `required` も同じ理由で効きません。
- **`prompt` / `alert` / `confirm` は無視される**（`allow-modals` が無い）。訊くのはページの中の
  `<input>`、報せるのはページの中の要素です。
- **`onState` を張ったら最後に `ready()` を呼ぶ。** 呼ばないとデータは永久に来ず、ページは
  「読み込み中」のまま止まります。

### views/signup.html

読めるのは `classes` だけ。`memberEmail` と `status` は親が入れるので送りません。

```html
<label>お名前 <input id="who" maxlength="40" /></label>
<p id="say" role="status"></p>
<div id="list"></div>
<script>
  const view = window.__MC_APP_VIEW;
  const list = document.getElementById("list");
  const who = document.getElementById("who");
  const say = document.getElementById("say");

  view.onState(({ classes = [] }) => {
    const rows = classes.slice().sort((a, b) => String(a.startsAt ?? "").localeCompare(String(b.startsAt ?? "")));
    list.replaceChildren(
      ...rows.map((klass) => {
        // textContent と dataset で組み立てること。クラス名は人が入力するもので、
        // 文字列連結で innerHTML に入れると公開ページでそれが動きます。
        const row = document.createElement("div");
        const name = document.createElement("span");
        name.textContent = `${klass.startsAt ?? ""} ${klass.title ?? klass.id}`;
        const go = document.createElement("button");
        // type を書くこと。省略した <button> は submit ボタンで、サンドボックスが
        // 送信を止める側の形です。
        go.type = "button";
        go.dataset.klass = klass.id;
        go.textContent = "申し込む";
        row.append(name, go);
        return row;
      }),
    );
  });

  list.addEventListener("click", async (event) => {
    const classId = event.target.dataset?.klass;
    if (!classId) return;
    const memberName = who.value.trim();
    if (memberName === "") {
      say.textContent = "お名前を入れてください。";
      who.focus();
      return;
    }
    // 送るのは文字列だけ。数値や真偽値が 1 つでも混ざると、そのキーが落ちるのではなく
    // メッセージ全体が申込みでなくなり、not-a-submission として拒否されます。
    const result = await view.submit("bookings", { classId, memberName });
    // 失敗は「満席」ではありません — このアプリに満席という状態はない。解禁前
    // （window）、サインインしていない、二重申込み（idFrom）のどれかです。
    say.textContent = result.ok ? "受け付けました。順位は「自分の申込み」で見られます。" : `申し込めませんでした: ${result.error ?? "unknown"}`;
  });

  view.ready();
</script>
```

### views/mine.html

`audience: "participant"`、入口は `/p/{slug}`。順位はここでしか出せません。

```html
<div id="mine"></div>
<p id="say" role="status"></p>
<script>
  const view = window.__MC_APP_VIEW;
  const mine = document.getElementById("mine");
  const say = document.getElementById("say");

  // 順位は「読めた行から数えるもの」。cancelled を除いて createdAt の昇順に並べ、
  // 何番目かを見るだけで、どこにも保存しません。
  //
  // createdAt はサーバが入れた `…Z` の文字列（上の stampField を見ること）で、
  // 辞書順がそのまま時刻順。だから素の文字列比較でよく、new Date() に通しては
  // いけない — ミリ秒までしか残らず、同着が読んだ順に戻ります。
  const ranked = (bookings, classId) =>
    bookings
      .filter((row) => row.classId === classId && row.status !== "cancelled")
      .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

  const standing = (rank, klass) => {
    const capacity = Number(klass.capacity ?? 0);
    if (rank < capacity) return "確定";
    return `待機 ${rank - capacity + 1} 番`;
  };

  view.onState(({ classes = [], bookings = [] }, viewer = {}) => {
    const rows = classes.flatMap((klass) => {
      const queue = ranked(bookings, klass.id);
      const rank = queue.findIndex((row) => row.memberEmail === viewer.me);
      return rank === -1 ? [] : [{ klass, row: queue[rank], text: standing(rank, klass) }];
    });

    mine.replaceChildren(
      ...rows.map(({ klass, row, text }) => {
        const box = document.createElement("div");
        const name = document.createElement("span");
        name.textContent = `${klass.startsAt ?? ""} ${klass.title ?? klass.id} — ${text}`;
        const off = document.createElement("button");
        off.type = "button";
        off.dataset.booking = row.id;
        // 確認はページの中で。confirm() はサンドボックスに無視され、false が
        // 返るので「押しても何も起きないボタン」になります。
        off.textContent = off.dataset.armed === "yes" ? "取り消す？" : "キャンセル";
        box.append(name, off);
        return box;
      }),
    );
    if (rows.length === 0) mine.textContent = "申込みはありません。";
  });

  mine.addEventListener("click", async (event) => {
    const button = event.target;
    const id = button.dataset?.booking;
    if (!id) return;
    if (button.dataset.armed !== "yes") {
      button.dataset.armed = "yes";
      button.textContent = "取り消す？";
      return;
    }
    // selfTransitions で本人に許されているのは requested → cancelled だけ。
    const result = await view.transition("bookings", id, "cancelled");
    say.textContent = result.ok ? "取り消しました。" : `取り消せませんでした: ${result.error ?? "unknown"}`;
  });

  view.ready();
</script>
```

**そして deploy の前に、プレビューで実際に押してもらってください**（[SKILL.md](../SKILL.md) の
「3b. RUN THE PAGE」）。このページの不具合は読んでも見つかりません。とくにこの形は、申込み
ボタンを 1 回押して**確認ダイアログが出るところまで**見てもらう価値があります — 出なければ、
メッセージは iframe から出ていません。

定員（8 と 2）は**クラスのレコード**に持たせてあります。クラスごとに変えられ、
ルールは読みません。**これは表示上の定員です** — 9 番目の人が現場に来ることは
止められません。順位方式ではデータが壊れないので、これは不整合ではなく運用の話です。
法的・課金的に厳格な定員が要るアプリには、この形は向きません。

## 繰り上げ

**書き込みが起きないので、通知の起点がありません。**

- 画面を開けば繰り上がりが見える（順位が詰まるだけなので即時）
- **メールは飛ばない**

キャンセルした人の行を起点に待機者へメールを積む形は、宛先が**別のレコードの人**に
なるため、`mail` の安全性の前提（宛先はそのレコードから再導出する）を崩します。
通知が要るなら、今のところ別の仕組み（サーバ側のトリガ）が必要です。

---

## 読み取り権限 — ここだけ先に決める

順位は**読めた行からしか計算できません**。

| 形 | 順位が見えるか | 代償 |
|---|---|---|
| 会員を名簿に載せる（`participant` + `peerVisibility: "public"`） | 見える | **参加者の名前が互いに見える** |
| 名簿に載せず公開投稿だけ | **見えない**（自分の行しか読めない） | 自分が何番目かも分からない |

ジムは会員制なので前者が自然ですが、**先に確認してください**。

参照: [SKILL.md](../SKILL.md)、担当者が承認する形は [salon.md](./salon.md)。
