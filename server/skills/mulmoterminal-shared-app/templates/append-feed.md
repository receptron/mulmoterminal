# テンプレート: 追記だけのフィード（閉じたメンバーが書き足す記録）

**いつ使うか** — 決まった人たちだけが**書き足していき、後から書き換えられない**記録。
引き継ぎノート、障害対応の時系列、チームの作業ログ、授業の質問ボード、雑談部屋。
「行を足すだけ」「消せるのは書いた本人だけ」「一覧は新しい順に伸び続ける」ならこの形です。

**チャットに見えますが、チャットのテンプレートではありません。** ページが吹き出しで並ぶのは
追記型の記録に一番合う見せ方だからで、宣言のほうは「1 つのコレクションに追記し、書き換えは
無く、削除は本人だけ」という形しか言っていません。上に挙げた 5 つはどれも同じ宣言になります。

要点は 3 つあります。

**`writerDelete` を書かない。** 他のテンプレートが**足す**キーを、ここでは**足さないことが設計**
です。オーナーが他人の行を消せない記録は、消せる記録とは別のものになります
（[project-board.md](./project-board.md) がちょうど裏返しで、あちらはオーナーが放置された担当を
外せることが要件）。

**`public.enabled: false` と、中身の入った `public.submit` は矛盾しない。** 名前が罠です。
`enabled` は**通りすがりの人**の読みと投稿を開けるキー、`public.submit` は**投稿の形**
（`emailField`、`stampField`、`selfDelete`）が住んでいる場所。メンバー限定で、投稿者に行を
結びつけるアプリは、**後者だけが要る**。

**`views[].limit` — 伸び続けるコレクションを読み切らない。** 予約表と違って、この形のコレクションは
**アプリの年齢に比例して**大きくなります。上限を宣言しないと、3 年目の 1 回の表示が 3 年分の
読み取りになる。`limit` はこのためにあります。

---

## app.json

```json
{
  "aid": "(init が書きます。手で触らないこと)",
  "name": "チームの記録",
  "slug": "team-log",
  "protocol": "1.0.0",
  "members": {
    "owner@example.jp": { "*": "owner" },
    "aoi@example.jp": { "*": "editor" },
    "ken@example.jp": { "*": "editor" }
  },
  "collections": {
    "messages": {
      "submitOnly": true,
      "statusField": "status"
    }
  },
  "views": [
    {
      "id": "room",
      "audience": "member",
      "path": "views/room.html",
      "collections": ["messages"],
      "live": ["messages"],
      "limit": { "messages": 200 }
    }
  ],
  "public": {
    "enabled": false,
    "read": [],
    "submit": {
      "messages": {
        "auth": "verifiedEmail",
        "emailField": "author",
        "stampField": "postedAt",
        "createFields": ["author", "body", "postedAt", "status"],
        "initialStatus": "posted",
        "selfDelete": ["posted"],
        "validate": { "required": ["body"] }
      }
    }
  }
}
```

**`protocol` は publish 契約の版**です。宣言は**下限**で、publish される値ではありません。
宣言より古い publisher は**拒否**されるので、新しい書き方に頼ったアプリが、それを実装していない
publisher に黙って通ることがありません。何も宣言しないアプリは `1.0.0`。

**入口は 1 つだけ**です。`/m/team-log` に、名簿に載っている人が入る。`/a/team-log` は
「この住所には何もありません」と答えます（`enabled: false`）。`/p/` も作っていません —
参加者ページは「自分の行だけ」を見せる入口で、この形の読者が見たいのは**全員の行**だからです。

**`submitOnly: true` は、書き込み経路を投稿 1 本に絞ります。** これが無いと owner / editor は
コレクションに直接書けてしまう — 直接の書き込みには `emailField` の縛りも `stampField` も
かからないので、他人の名前の行も、好きな時刻の行も作れる。追記だけの記録で
**一番守りたいのはそこ**なので、このキーは外せません。

## .claude/skills/messages/schema.json

```json
{
  "title": "記録",
  "icon": "forum",
  "primaryKey": "id",
  "storage": { "type": "firestore" },
  "fields": {
    "id": { "type": "string", "label": "ID", "primary": true, "required": true },
    "author": { "type": "email", "label": "書いた人", "required": true },
    "body": { "type": "string", "label": "本文", "required": true },
    "postedAt": { "type": "datetime", "label": "投稿時刻" },
    "status": { "type": "enum", "label": "状態", "values": ["posted"] }
  }
}
```

**`status` の値は 1 つだけ**で、飾りではありません。ルールは `selfDelete` を見る前に**その行の
今の状態**を読むので、`statusField` の無いコレクションには自己削除が一切効きません。状態が
1 つしかない記録でも、消せるようにしたいなら enum を 1 つ置きます。

**`postedAt` は `datetime` で宣言します。** 数値（epoch millis）にしたくなりますが、`stampField`
に数値フィールドを指すと publish が拒否します。書くのはルールで、UTC・小数 9 桁・`Z` 付きの
文字列が入る — 生成スクリプトが触るフィールドではありません。

そして**この宣言が `limit` の前提**です。`limit` は「新しい順に N 件」であって「適当に N 件」では
ないので、並び順を決めるフィールドが要る。それを著者に選ばせず `public.submit[cid].stampField`
から取るのは、**ルールが `request.time` で固定し、以後の書き換えを禁じている唯一のフィールド**
だからです。並び替えに使う値を投稿者が決められるなら、上限は「最新の 200 件」を意味しません。

## views/room.html — メンバーが読み書きする 1 枚

**リポジトリの root から見た `views/` に置きます**（`app.json` と同じ場所を起点に、
`views/<name>.html` の 1 枚だけ）。

**`prompt` / `alert` / `confirm` は動きません** — ビューは `sandbox="allow-scripts"` の中で、
`allow-modals` の無い呼び出しは無視されます。訊くのはページの中の要素で、下の「…」メニューが
その形です（削除の確認をダイアログではなくメニューの中でやっているのはこれが理由）。

**`<form>` も使えません。** `allow-forms` が無いので、ブラウザは `submit` イベントを**発火する
前に**送信ごと止めます — `onsubmit` の中の `preventDefault()` すら走らない。`<div>` と
`type="button"` のボタンにして、**click** で送り、入力チェックは自分で書きます。

色は 1 つの `--hue` から作っていて、**変えるためにあります** — これはこのテンプレートの色で、
あなたのアプリの色ではありません。決まりごとは [design.md](./design.md)。

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  /* 色はすべて 1 つの hue から。決まりごとは design.md。アプリごとに変えること。 */
  :root {
    --hue: 175;                                    /* teal - 積み上がっていく記録 */
    --main: oklch(47% .09 var(--hue));           --fill: oklch(96% .018 var(--hue));
    --line: oklch(47% .09 var(--hue) / .16);     --ink: oklch(23% .015 var(--hue));
    --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
  }
  * { box-sizing: border-box; }
  html { height: 100%; background: var(--paper); color: var(--ink); color-scheme: light; }
  body { height: 100%; display: flex; flex-direction: column; overflow: hidden; margin: 0; font: 15px/1.5 system-ui, "Hiragino Sans", sans-serif; }
  .bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: #fff; }
  .bar h1 { margin: 0; font-size: 15px; font-weight: 780; letter-spacing: -.01em; }
  .hash { color: var(--main); font-weight: 800; font-size: 17px; line-height: 1; }
  .who { margin-left: auto; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .thread { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 0 14px; }
  /* 右の余白は「…」ボタンの席。絶対配置なので、ここで空けておかないと長い 1 行目が下を通る。 */
  .msg { position: relative; display: grid; grid-template-columns: 36px 1fr; gap: 0 10px; padding: 3px 42px 3px 14px; }
  .msg:hover { background: var(--fill); }
  .msg.lead { margin-top: 10px; }
  .thread > .row:first-child .msg.lead { margin-top: 0; }
  .avatar { grid-row: span 2; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9px; color: #fff; font-size: 15px; font-weight: 780; user-select: none; }
  .msg:not(.lead) .avatar { visibility: hidden; height: 0; }
  .head { display: flex; align-items: baseline; gap: 8px; line-height: 1.3; }
  .name { font-size: 14.5px; font-weight: 780; letter-spacing: -.01em; }
  .time { color: var(--muted); font-size: 11.5px; }
  .body { overflow-wrap: anywhere; line-height: 1.45; white-space: pre-wrap; }
  .msg:not(.lead) .body { grid-column: 2; }
  /* 常に見えていること。hover でだけ出すと、タッチでは永久に触れない。 */
  .tools { position: absolute; top: 1px; right: 8px; z-index: 4; display: flex; padding: 1px; }
  .kebab { display: flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: oklch(53% .02 var(--hue) / .55); font: inherit; font-size: 15px; line-height: 1; cursor: pointer; }
  .kebab:hover, .msg.open .kebab { background: var(--fill); color: var(--ink); }
  .menu { position: absolute; top: 14px; right: 12px; z-index: 5; min-width: 170px; padding: 4px; border: 1px solid var(--line); border-radius: 10px; background: #fff; box-shadow: 0 10px 28px oklch(30% .05 var(--hue) / .16); }
  .menu.up { top: auto; bottom: 14px; }            /* 末尾の行は下に開く場所が無いので上へ */
  .menu .label { display: block; padding: 6px 10px 4px; color: var(--muted); font-size: 11.5px; font-weight: 750; }
  .item { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; font-size: 13px; font-weight: 650; line-height: 1; text-align: left; cursor: pointer; }
  .item:hover { background: var(--fill); }
  .item.danger { color: oklch(45% .16 28); }
  .day { display: flex; align-items: center; gap: 12px; margin: 16px 16px 6px; color: var(--muted); font-size: 11.5px; font-weight: 750; }
  .day::before, .day::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .older { margin: 10px 14px 4px; padding: 6px 10px; border-radius: 8px; background: var(--fill); color: var(--muted); font-size: 11.5px; text-align: center; }
  .empty { padding: 18px; color: var(--muted); font-size: 14px; }
  .composer { flex: 0 0 auto; padding: 0 14px 12px; }
  .box { padding: 8px 8px 6px; border: 1px solid oklch(47% .09 var(--hue) / .3); border-radius: 12px; background: #fff; }
  .box:focus-within { border-color: var(--main); box-shadow: 0 0 0 3px oklch(47% .09 var(--hue) / .13); }
  textarea { display: block; width: 100%; min-height: 22px; max-height: 34vh; padding: 2px 4px; border: 0; background: transparent; color: var(--ink); font: inherit; line-height: 1.45; overflow-y: auto; resize: none; }
  textarea:focus { outline: none; }
  .foot { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .hint { color: var(--muted); font-size: 11.5px; }
  .hint.bad { color: oklch(45% .16 28); font-weight: 700; }
  .send { min-height: 30px; margin-left: auto; padding: 0 14px; border: 1px solid transparent; border-radius: 8px; background: var(--main); color: var(--paper); font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; touch-action: manipulation; }
  .send:disabled { opacity: .4; cursor: default; }
</style>
<div class="bar">
  <span class="hash">#</span>
  <h1>team-log</h1>
  <span class="who" id="who"></span>
</div>
<!-- role="log" は、届いた行を「耳で読んでいる人」に届けるための宣言です。aria-live: polite と
     aria-relevant: additions を含むので、新しい行だけが読み上げられ、既にある行は読み直されない。
     含意に任せず書き下しているのは、そこがブラウザごとに違うからです。 -->
<div class="thread" id="thread" role="log" aria-live="polite" aria-relevant="additions" aria-label="記録">
  <div class="empty">読み込んでいます…</div>
</div>
<div class="composer">
  <div class="box">
    <textarea id="body" rows="1" placeholder="#team-log に書く" aria-label="本文"></textarea>
    <div class="foot">
      <span class="hint" id="hint">Enter で送信 · Shift+Enter で改行</span>
      <button type="button" class="send" id="post">送信</button>
    </div>
  </div>
</div>
<script>
  const view = window.__MC_APP_VIEW;
  const thread = document.getElementById("thread");
  const whoEl = document.getElementById("who");
  const bodyEl = document.getElementById("body");
  const postBtn = document.getElementById("post");
  const hint = document.getElementById("hint");

  /** app.json の `limit.messages` と同じ数。ページは app.json を読めないので、2 か所に書く
   *  しかありません。ここでの用途は「ちょうど上限まで届いた＝これより前がある」の判定だけで、
   *  行を slice するのに使ってはいけない — 切るのはホストの仕事で、こちらが重ねて切ると
   *  上限を下げたときに黙って表示だけ減ります。 */
  const CAP = 200;

  let latest = null;          // 描画元はここ 1 つだけ
  let menuFor = null;         // 「…」メニューが開いている行の id
  let confirming = null;      // 削除を確認中の行の id

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nameOf = (email) => String(email || "だれか").split("@")[0];

  // postedAt はサーバのスタンプ。普通は文字列（UTC・小数 9 桁・Z）で届きますが、ホストによっては
  // Firestore の生の timestamp が来ます。String({seconds}) は "[object Object]" なので、時計も
  // 並び順も黙って壊れる。まず 1 つの形に正規化して、9 桁に揃えてから **文字列として** 比べる —
  // 辞書順が時刻順になります。
  const stampKey = (v) => {
    if (v == null) return "";
    if (typeof v === "string") {
      const m = v.match(/^(.*T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?Z?$/);
      return m ? `${m[1]}.${(m[2] || "").padEnd(9, "0")}Z` : v;
    }
    if (v instanceof Date) return v.toISOString().replace(/\.\d+Z$/, ".000000000Z");
    if (typeof v.toDate === "function") return stampKey(v.toDate());
    const secs = v.seconds ?? v._seconds;
    if (typeof secs === "number") {
      const nanos = Number(v.nanoseconds ?? v._nanoseconds ?? 0);
      return new Date(secs * 1000).toISOString().replace(/\.\d+Z$/, "") + "." + String(nanos).padStart(9, "0") + "Z";
    }
    return "";
  };

  // スタンプの無い行をどこに置くか。これが「自分の投稿の見え方」を決めます。
  // postedAt を書くのはルールなので、送った本人のブラウザは **スタンプが入る前の** 行を先に
  // 受け取る（ローカルのスナップショットで null、サーバが書いた後にもう一度）。生のキーで
  // 並べると "" は先頭なので、自分の投稿がいったん一番上に出て、直後に一番下へ飛ぶ — その
  // 2 回の移動で、間にある全部の行の日付区切りとグループ化がやり直しになります。ページが
  // 勝手に描き直しているように見えるのはこれ。
  // スタンプの無い行は「いま書かれている行」なので、置き場所は **最後** です。そこが最終的な
  // 位置でもあるので、スタンプが届いても動くのは時計だけになります。
  const orderKey = (v) => stampKey(v) || "￿";

  const asDate = (v) => { const k = stampKey(v); return k ? new Date(k.replace(/(\.\d{3})\d+/, "$1")) : null; };
  const clock = (s) => { const d = asDate(s); return d && !isNaN(d) ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""; };
  const dayOf = (s) => { const d = asDate(s); return d && !isNaN(d) ? d.toDateString() : ""; };
  const dayLabel = (s) => {
    const d = asDate(s);
    if (!d || isNaN(d)) return "";
    const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days === 0) return "今日";
    if (days === 1) return "昨日";
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric", weekday: "long" });
  };

  // 書いた人ごとの色をアドレスから作る。安定していて、画像が要らない。
  const tint = (email) => {
    let h = 0;
    for (const ch of String(email || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `oklch(58% .13 ${h})`;
  };

  const atBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;

  // いま画面にあるもの: id → { html, node }。ページは onState のたびに描き直し、本番は
  // **変更のたびに** onState を送ってきます。だから innerHTML を書き直す作りだと、誰か 1 人の
  // 投稿で、全員の画面の全行が破棄されて作り直される。それがちらつきの正体で、変わっていない
  // ノードまで再描画され、選択中の文字は外れ、ポインタが乗っていた hover も消えます。
  // 行の HTML の作り方はそのままに、id で **差分を取る**: 変わっていない行は DOM ノードごと
  // 据え置き、変わった行だけその場で patch、本当に新しい行だけ作る。
  let painted = new Map();

  /** thread の子要素を parts（[{ key, html }] を表示順に）に合わせる。 */
  const paint = (parts) => {
    const next = new Map();
    parts.forEach((part, i) => {
      const was = painted.get(part.key);
      let node;
      if (was && was.html === part.html) {
        node = was.node;                    // 据え置き: 読みもしない
      } else if (was) {
        node = was.node;
        node.innerHTML = part.html;         // この行だけ描き直す
      } else {
        node = document.createElement("div");
        node.className = "row";
        node.innerHTML = part.html;
      }
      // insertBefore は既にある node を **移動** するので、これで順序も直ります。
      if (thread.children[i] !== node) thread.insertBefore(node, thread.children[i] || null);
      next.set(part.key, { html: part.html, node });
    });
    while (thread.children.length > parts.length) thread.removeChild(thread.lastElementChild);
    painted = next;
  };

  const render = () => {
    if (!latest) return;
    const { data, viewer } = latest;
    const can = (viewer.can && viewer.can.messages) || {};
    const me = viewer.me || "";
    const stick = atBottom();
    whoEl.textContent = me ? `${nameOf(me)} · メンバー限定` : "メンバー限定";

    // 届いた行を古い順に。ホストは新しい順に上限まで切って渡してくるので、こちらは並べ直す
    // だけで、**件数は減らしません**。
    const rows = (data.messages || []).slice().sort((a, b) =>
      orderKey(a.postedAt).localeCompare(orderKey(b.postedAt)) || String(a.id).localeCompare(String(b.id))
    );

    if (!rows.length) {
      painted = new Map();
      thread.innerHTML = `<div class="empty">#team-log はまだ空です。最初の 1 行をどうぞ。</div>`;
      return;
    }

    let prev = null;
    const parts = rows.map((r, i) => {
      // 同じ人の 5 分以内の連投は 1 つの見出しにまとめる。
      const newDay = dayOf(prev && prev.postedAt) !== dayOf(r.postedAt);
      const sameRun = prev && !newDay && prev.author === r.author && Math.abs(asDate(r.postedAt) - asDate(prev.postedAt)) < 5 * 60 * 1000;
      const divider = newDay && dayOf(r.postedAt) ? `<div class="day"><span>${esc(dayLabel(r.postedAt))}</span></div>` : "";
      prev = r;

      const open = menuFor === r.id;
      const armed = confirming === r.id;
      // 本人だけが消せる。決めているのはルールです。withdrawFrom は selfDelete に挙げた状態の
      // 一覧で、ルールはそれを **その行から** 答える（ownRow が author と呼び出し元の検証済み
      // アドレスを比べる）。だから他人の行でこれを押した人は Firestore に拒否される — ここで
      // 描かないのは礼儀であって、守っているのは下の比較ではありません。
      const mine = me && r.author === me;
      const canDelete = mine && (can.withdrawFrom || []).includes(r.status);
      const tools = canDelete
        ? `<div class="tools"><button type="button" class="kebab" id="kebab-${esc(r.id)}" data-menu="${esc(r.id)}" aria-haspopup="menu" aria-expanded="${open}" aria-label="この行の操作">…</button></div>${
            open
              ? `<div class="menu${i >= rows.length - 2 ? " up" : ""}" role="menu" aria-labelledby="kebab-${esc(r.id)}">${
                  armed
                    ? `<span class="label" role="presentation">全員から消しますか？</span>
                       <button type="button" role="menuitem" class="item danger" data-del="${esc(r.id)}">はい、消す</button>
                       <button type="button" role="menuitem" class="item" data-close="1">やめる</button>`
                    : `<button type="button" role="menuitem" class="item danger" data-arm="${esc(r.id)}">この行を消す…</button>`
                }</div>`
              : ""
          }`
        : "";

      const head = sameRun ? "" : `<div class="head"><span class="name">${esc(nameOf(r.author))}</span><span class="time">${esc(clock(r.postedAt))}</span></div>`;

      // キーは id、比較の対象は html 全体。隣の行が届いたせいでこの行の日付区切りや連投の
      // まとめ方が変わったなら文字列が変わり、その行だけ patch される。何も動いていなければ、
      // 配列そのものは毎回新しくても据え置かれます。
      return {
        key: String(r.id),
        html: `${divider}<div class="msg${sameRun ? "" : " lead"}${open ? " open" : ""}">
        <div class="avatar" style="background:${tint(r.author)}">${esc(nameOf(r.author).slice(0, 1).toUpperCase())}</div>
        ${head}
        <div class="body">${esc(r.body)}</div>
        ${tools}
      </div>`,
      };
    });

    // ちょうど上限まで届いたということは、その先がある。何件あるかは **言えません** —
    // ホストが数えずに切っているので、ページは自分が見ていない行の数を知らない。知らないことを
    // 数で言わないための一文です。
    const truncated = rows.length >= CAP;
    paint(truncated ? [{ key: "older", html: `<div class="older">これより前の記録はここには出ません。</div>` }, ...parts] : parts);

    // メニューは **フォーカスが入る場所** です。role="menu" と言いながらフォーカスをボタンに
    // 置いたままにするのが、この形で一番人を騙す半端さ: 読み上げは「自分が入っていないメニュー」
    // を告げ、下の矢印キーは動かす対象を持たない。開いたままの描画のたびに、あるべき項目へ
    // フォーカスを置きます（行は paint が作り直すので、開いた瞬間に 1 回では足りない）。
    if (menuFor !== null) focusMenu();
    if (stick) thread.scrollTop = thread.scrollHeight;
  };

  const say = (text, bad) => {
    hint.className = bad ? "hint bad" : "hint";
    hint.textContent = text || (bad ? "" : "Enter で送信 · Shift+Enter で改行");
  };

  const grow = () => { bodyEl.style.height = "auto"; bodyEl.style.height = bodyEl.scrollHeight + "px"; };
  bodyEl.addEventListener("input", grow);

  const closeMenu = () => { menuFor = null; confirming = null; };
  const menuItems = () => [...thread.querySelectorAll('.menu [role="menuitem"]')];

  /** 開いているメニューにフォーカスを入れる。描き直しをまたいで項目の位置を覚えているので、
   *  削除を確認中にしてもフォーカスがメニューの先頭へ戻りません。 */
  let menuAt = 0;
  const focusMenu = () => {
    const items = menuItems();
    if (items.length === 0) return;
    menuAt = Math.min(menuAt, items.length - 1);
    if (!items.includes(document.activeElement)) items[menuAt].focus();
  };

  /** メニューが閉じたときにキーボードの人が居たい場所 — 開いたボタンの上。ここへ戻さないと、
   *  フォーカスは document に落ち、ページの先頭からやり直しになります。 */
  const leaveMenu = (id) => {
    closeMenu();
    menuAt = 0;
    render();
    const kebab = document.getElementById(`kebab-${id}`);
    if (kebab) kebab.focus();
  };

  thread.addEventListener("click", async (e) => {
    const kebab = e.target.closest("[data-menu]");
    if (kebab) {
      const id = kebab.getAttribute("data-menu");
      const wasOpen = menuFor === id;
      closeMenu();
      menuAt = 0;
      if (wasOpen) { leaveMenu(id); return; }
      menuFor = id;
      render();
      return;
    }
    const arm = e.target.closest("[data-arm]");
    if (arm) { confirming = arm.getAttribute("data-arm"); render(); return; }
    if (e.target.closest("[data-close]")) { leaveMenu(menuFor); return; }
    const del = e.target.closest("[data-del]");
    if (!del) {
      if (menuFor) { closeMenu(); render(); }     // 他の場所を押したらメニューは閉じる
      return;
    }
    del.disabled = true;
    // withdraw を持たない古いランタイムでは、呼ぶとフレームの中で例外になります —
    // 見え方は「押しても何も起きないボタン」と同じなので、有無を確かめてから呼ぶ。
    const res = typeof view.withdraw === "function"
      ? await view.withdraw("messages", del.getAttribute("data-del"))
      : { ok: false, error: "このアプリのランタイムは削除に対応していません" };
    closeMenu();
    say(res.ok ? "" : `消せませんでした: ${res.error}`, !res.ok);
    render();
    // フォーカスを持っていた行は消えました。次に行きたいのはどのみち入力欄で、そこは
    // 足元から消えない唯一の場所です。
    bodyEl.focus();
  });

  document.addEventListener("click", (e) => {
    if (menuFor && !e.target.closest(".menu, .tools")) { closeMenu(); render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (menuFor === null) return;
    if (e.key === "Escape" || e.key === "Tab") { leaveMenu(menuFor); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = menuItems();
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    menuAt = (Math.max(at, 0) + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[menuAt].focus();
  });

  let sending = false;
  const send = async () => {
    // 1 度に 1 つ。ガードがボタンではなくここに在るのは、Enter がボタンの disabled を訊かない
    // からです — 2 連打で 2 通目が飛び、ホストが busy として拒否したものが「成功したはずの
    // 操作のエラー表示」として出ていました。
    if (sending) return;
    const text = bodyEl.value.trim();
    if (!text) { say("何か書いてください。", true); return; }
    const me = (latest && latest.viewer.me) || "";
    sending = true;
    postBtn.disabled = true;
    // values に入れてよいのは文字列だけ。他の型が混じると投稿として扱われません。
    const res = await view.submit("messages", { author: me, body: text });
    sending = false;
    postBtn.disabled = false;
    if (res.ok) {
      // **送った分だけ** 消す。投稿は確認と書き込みを待つので、その間に打ち続けた人は
      // 既に次の 1 通を書いています — 無条件に空にすると、それを捨てることになる。
      if (bodyEl.value.trim() === text) bodyEl.value = "";
      grow();
      say("");
    } else if (res.error === "cancelled") {
      say("");                                    // エラーではなく、本人が確認をやめただけ
    } else {
      say(`送れませんでした: ${res.error}`, true);
    }
    bodyEl.focus();
  };

  postBtn.addEventListener("click", send);
  bodyEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  view.onState((data, viewer) => { latest = { data, viewer }; render(); });
  view.ready();
</script>
```

## なぜこの形か — 迷いやすい 6 点

### 1. `writerDelete` を **書かない** ことが仕様

`selfDelete` は `deleteWith` の最後の枝で、`ownRow` に行き着きます。`ownRow` は `author` を
呼び出し元の検証済みアドレスと比べるだけで、**その人がどのロールかを一切訊きません**。だから
オーナーが他人の行の削除を押しても Firestore に拒否されます。

ここに `collections.messages.writerDelete: true` を足すと、その瞬間から owner と editor は
**誰の行でも**消せるようになります。追記だけの記録では、それは別の製品です — 後から都合の悪い
行を消せる記録は、記録として使えない。足すかどうかは要件の問題で、迷ったら**足さない**側が
この形です。

消す必要が出てくるのは普通「荒らし」で、そのときに要るのは全行削除の権限ではなく**名簿から
外すこと**（`app.json` の `members` から 1 行消して publish）。過去の行は残りますが、それは
記録なので残ってよい。

### 2. `public.enabled: false` の下に `public.submit` を書く

`enabled` は**通りすがりの人**に対する 2 つの許可（読みと、匿名の作成）のスイッチです。
`false` にすると `/a/{slug}` は「この住所には何もありません」と答えます。

`public.submit` はまったく別のもので、**投稿というものの形**が住んでいる場所です:
どのフィールドに投稿者のアドレスを固定するか（`emailField`）、どこに時刻を打つか
（`stampField`）、作成時に何を書いてよいか（`createFields`）、本人が消せる状態はどれか
（`selfDelete`）。メンバー限定のアプリでも、メンバーが投稿する以上これは要ります。

**両方要らないのはどちらか一方だけ**、という思い込みが罠です。ここは「公開しない、しかし
投稿の形は宣言する」で、宣言としては何も矛盾していません。

### 3. `limit` は「新しい順に N 件」で、順序はあなたが選ばない

```json
"limit": { "messages": 200 }
```

これが無いと、**メンバーページを 1 回開くたびにコレクション全体**が読まれ、`live` なら
全体を購読します。予約表は枠の数で頭打ちになりますが、追記だけの記録は**アプリの年齢に
比例して**伸びるので、3 年目には 3 年分を読む。ここが他のテンプレートと違うところです。

並び順のフィールドは `public.submit.messages.stampField` から取られ、著者は選べません。
理由は 1 つ: それが**ルールが `request.time` で固定し、以後の書き換えを禁じている唯一の
フィールド**だから。並び替えの基準を投稿者が書き換えられるなら、「最新の 200 件」は
「投稿者が最新だと言い張った 200 件」になります。

publish が拒否する形が 4 つあります。どれも黙って壊れる代わりの拒否です:

- `collections` に挙げていないコレクションへの `limit`（読んでいないものは切れない）
- 1000 を超える件数
- `stampField` を宣言していないコレクション（**並びの無い上限は、任意の N 件**になる。
  Firestore は orderBy の無い limit をドキュメント id 順で切るので、新しい行が永久に
  届かないページになり、どこにもエラーは出ません）
- 参加者ページの「自分の行だけ」のビュー（複合インデックスが要るため）

**上限に達したことをページは数で言えません。** ホストは数えずに切るので、200 件届いた
ページは「その先がある」ことしか知らない。上のページが件数ではなく一文を出しているのは
そのためです。

### 4. `live` と `limit` は一緒に使う

`live: ["messages"]` はページを購読にします — 誰かが書いた瞬間に全員の画面に出る。
そして購読は**開きっぱなし**なので、上限が効くのはここが一番大きい。片方だけを足すと
「動くけれど際限なく読む」か「軽いけれど動かない」のどちらかになります。

### 5. スタンプの無い行は **最後**

自分の投稿は、サーバがスタンプを書く前に自分のブラウザに届きます。空のキーを先頭に置くと、
投稿のたびに自分の行が一番上に出てから一番下へ飛び、その 2 回の移動で間の行の日付区切りが
やり直しになる。「ページが勝手に描き直している」ように見える現象はほぼこれです。
ページ側の `orderKey` が `"￿"` を返しているのはその 1 行の対策で、**この形のページを
書くなら必ず要ります**。

### 6. 描き直しは id で差分を取る

本番は変更のたびに `onState` を送ってきます。`innerHTML` を丸ごと書き直す作りだと、
**誰か 1 人の投稿で全員の画面の全行が作り直される** — 選択中の文字が外れ、hover が消え、
長い記録ほど目に見えてちらつきます。id をキーに差分を取れば、1 行届いても触るのは 1 要素です。

## 落とし穴

- **編集を足したくなったら、この形ではありません。** `submitOnly` と `createFields` は
  「作成のときに書いてよいフィールド」しか定義していません。書き換えを許すなら `selfUpdate`
  を宣言することになり、そこから先は「後から書き換えられない記録」ではなくなります。
  どちらが要件かを先に決めてください。
- **`/p/` を足しても「自分の行だけ」しか見えません。** 全員の行を読む場所は `/m/` です。
- **通知はありません。** ページを開いている人には即座に出ますが、閉じている人には何も届かない。
  メールを出すなら `collections.messages.mail` の宣言が要ります（状態遷移に紐づくので、
  状態が 1 つしかないこの形では、まず状態を増やす設計から）。
- **`messages` を検索できるページは、この宣言では作れません。** ホストが渡すのは最新の
  200 件だけで、その先を引く手段はページの側にない。検索が要るなら、それは別の設計
  （読み取りの範囲を分ける、期間で区切ったコレクションにする）です。

## 作る順番

1. `init` — 名前と slug を決めてアプリを取る
2. `.claude/skills/messages/SKILL.md` と `schema.json` を書く
3. `app.json` に `collections` / `views` / `public` を書き足す
4. `views/room.html` を置く
5. `check` — 宣言が publish できるかを訊く
6. `preview` — **本物のブラウザでページを走らせ、ボタンを押す**
7. `publish`
8. `invite` で名簿に足す（1 人 1 行、publish で反映）
