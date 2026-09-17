# fix-2095: Windows CI で shapescriptRenderTool のピクセル系が flake する

> **決着（2026-09-17）**: 当座の retry は入れたが、PR 自身の Windows ランで必須チェックは赤のまま
> だった —— そのランナーはページ読み込みに毎回 30 秒以上かかっていて、retry では届かない性質
> だったため。上流の `@mulmoclaude/shapescript-plugin@6.2.0`（receptron/mulmoclaude#3202、
> ナビゲーションの予算を 60 秒に）が公開され、bump したのでこの bridge は撤去した。
> 残ったのは1点だけ: ケースの予算を自前の `60_000` ではなく、パッケージが公開している
> `RENDER_BUDGET_MS` から取ること。

#2095 の**当座の緩和**。根本原因はプラグイン側（`receptron/mulmoclaude`）にあり、そちらは別 PR。

## 何が起きているか（実測）

`test/server/infra/shapescriptRenderTool.spec.ts` のラスタライズする3ケースが、Windows で
断続的に落ちる:

    TimeoutError: Navigation timeout of 30000 ms exceeded
     ❯ CdpPage.goto node_modules/puppeteer-core/src/api/Page.ts:1886:35
     ❯ A node_modules/@mulmoclaude/shapescript-plugin/dist/render.js:176:71

- Windows (daily): 直近12 run のうち5回失敗
- Windows (PR): **必須チェックでも発生**（run 35159396181）—— レンダリングと無関係な PR を止め得る
- 落ちる件数は run ごとに違う（PR の run は1件、daily は3件）ので、run 単位ではなく**レンダ単位**

## 原因はこのリポジトリの外

`@mulmoclaude/shapescript-plugin` の `src/render/renderer.ts` は、**ナビゲーションだけ**明示的な
予算を持たない:

```ts
timeout: LAUNCH_TIMEOUT_MS,                                        // 起動 30s
await page.goto(PAGE_URL, { waitUntil: "load" });                  // 指定なし → puppeteer 既定の 30s
await page.waitForFunction("…", { timeout: RENDER_TIMEOUT_MS });   // ラスタライズ 60s
```

`LAUNCH_TIMEOUT_MS` のコメント自身が「puppeteer の 30 秒既定を黙って継承しないため」と書いている。
`goto` がその例外として残っていた。ホスト側から渡す口は `RenderShapeScriptOptions` に無い。

手元の開発機では1レンダ約1.2秒。プラグインは呼び出しごとに Chromium を起動し直すので、負荷のかかった
Windows ランナーではそのナビゲーションが 30 秒に収まらないことがある。

## なぜ Windows だけか

ピクセル系は `it.runIf(canRender)` で、ブラウザがある環境でしか走らない。`windows-pr.yaml` と
`windows-daily.yaml` は `~/.cache/puppeteer` をキャッシュしているので Chromium が存在し、
`ci.yml`（ubuntu / macOS）はしないのでスキップされる。つまり**開発機以外で走るのは Windows CI だけ**
—— spec 自身のコメントが想定していた「開発機で走る」から外れている。

## この PR がすること

**レンダ呼び出しだけを、ナビゲーションタイムアウトに限って再試行する**（`RENDER_ATTEMPTS = 3`）。
新しい試行は新しい Chromium なので、断続的なナビゲーションタイムアウトはこれで越えられる。

**retry をケースではなく呼び出しに付けるのが要点。** 最初の形は Vitest の `retry` を使っていたが、
あれは**あらゆる失敗**を再試行する —— アサーション失敗も、保存先が違う欠陥も。実測で、1回目だけ
「saved render to the wrong directory」で落ちる欠陥がそのまま通った（Codex round 1 の P2）。
`retryingNavigationTimeouts()` に閉じ込めたので、アサーションの失敗はアサーションの失敗のまま残り、
**このファイルが存在する理由になっている flake だけ**が2度目をもらう。

**probe も同じクラス。** `it.runIf(canRender)` を決める module scope の probe が同じタイムアウトで
落ちると、3ケースは**黙ってスキップ**され、CI は緑のまま検証ゼロになる。probe も同じ関数を通す。

**規則は「許される形」を書く。禁じる形を並べない。** このループでは同じ規則に3回続けて指摘が来た
（Vitest の `retry` が何でも再試行する → probe に retry が無い → マッチャが部分一致で広すぎる）。
3つ目を個別に潰すのはやめる、というのがこのリポジトリのレビュー手順なので、通る形だけを書く:

```ts
err instanceof Error && err.name === "TimeoutError" && /^Navigation timeout of \d+ ms exceeded$/.test(err.message)
```

形は**実測**した。インストール済みの puppeteer で到達しないアドレスへ 150ms の予算で `goto` すると
`name: "TimeoutError"` / `message: "Navigation timeout of 150 ms exceeded"`（前後に何も付かない）。
`\d+` なのは、上流の修正で 60000 になるため —— 今日の 30000 を書くと、入れ替わる最中（まさに
flake を吸収したい期間）にマッチしなくなる。

これに当てはまらないものは、安全そうに見えても再試行しない —— 語句を**含む**だけのメッセージ、
Error でない reject、同じ文面が別の name を持つ（ラッパーが作る形）。それらは赤くなる。
**戻ってきた flake は見えるが、隠れた退行は見えない**からで、この判断は Codex の
round 2 follow-up でも「false negative は可視なので許容、false positive はごく狭い衝突のみ」と
合意している。

1ケースの予算は**自分で計算しない**。`RENDER_BUDGET_MS`（プラグインが公開している、1レンダの
ブラウザ側の予算）を import して `2 ×` を使う。**今入っている版では起動 + ラスタライズ**で、上流の
修正が入るとページ読み込みも含むようになる —— 派生させる理由がまさにそれで、この bridge が相手に
している phase の分だけ数が育つ。
ここの算術は2回続けて間違えた —— 試行ごとの予算をただ足しただけ（CodeRabbit）、次に「試行の合間の
ブラウザ起動1回分」という余白（Codex）—— が、**起動は合間ではなく毎回の試行が払う**。
派生させれば上流の修正でページ読み込みの予算が上がったときも一緒に動く。

**上限は回数だけでなく期限でも持つ。** `RENDER_ATTEMPTS × RENDER_BUDGET_MS` にすると、最悪ケース3つで
Windows ジョブの持ち時間を超える（Codex, round 4 follow-up）。helper は**残り時間で次の試行が
終わらないなら始めない**。普段は3回とも走る（flake はナビゲーションのタイムアウトで落ちるので
1予算の内側）。最後に失敗するのがレンダであることが重要で、そうでないと Vitest の
「test timed out」が本当のエラーを上書きしてしまう。

`RENDER_BUDGET_MS` はホスト側の仕事（`.shape` の読み込み、PNG の書き出し）や、パッケージが
タイムアウトを付けていない puppeteer 呼び出しまでは覆わない。予算であって証明ではない。

### Vitest 5 の書き方に注意

オプションは**第2引数**。`it(name, fn, { ... })` は Vitest 4 で削除されていて、走らせると
`TypeError: Signature "test(name, fn, { ... })" was deprecated in Vitest 3 and removed in Vitest 4`
になる。一方**数値**を第3引数に置く形は今も有効（20秒の処理が 60 秒予算で通ることを実測）。
つまり既存の `RENDER_TIMEOUT_MS` 渡しは効いていた。`{ timeout: CASE_TIMEOUT_MS }` へ移すときに
落とさないよう注意する。

## これで flake が止まるわけではない（PR 自身の Windows ラン `ec7859d7` で実測）

この PR の head で必須チェックは**赤になった**:

- 通ったケース 33.7 秒 —— 1回タイムアウトして retry で復帰（仕組みは効いている）
- 落ちたケース 93.7 秒 —— 30 秒のタイムアウトを**3回連続**して打ち止め

つまりそのランナーではページ読み込みが「たまに」ではなく**毎回** 30 秒を超える。新しい Chromium を
何回引いても届かず、効くのは予算を上げること —— 上流の修正だけ。**この PR は失敗を減らすが、
必須チェックを緑に保つものではない。**

## やらないこと

- **CI でピクセル系をスキップする**。flake は消えるが、CI での検証も消える。
- **プラグインのタイムアウトをここで回避する**（例: 自前で goto する）。ホストがレンダラの
  内部を再実装する話になる。

## 検証

- 3ケースがこの機械で**走って**通ること（黙ってスキップされていないこと）。
- retry 規則そのものを、ブラウザ無しで pin する —— 通る形（今日の 30000 と上流の 60000 の両方）と、
  **近接する外れ値5つ**（無関係な失敗 / 語句を含むだけ / 語句の後ろに追記 / Error でない reject /
  同じ文面で別の name）。片方向だけ書いたテストは、規則が何でも再試行するようになっても通る —— ナビゲーションタイムアウトは再試行される、
  それ以外は再試行されない、試行回数の上限で諦める。**ブラウザの無いホストでは他が全部スキップ
  されるので、レビュー対象の挙動が検証できるのはこの3つだけ**（Codex のサンドボックスは
  `4 passed | 3 skipped` だった）。
- 破壊検証: マッチャを何でも通す / 上限を広げる / 再試行しない、の3つがそれぞれ対応するテストを
  赤にする。
- Codex の P2 のシナリオ（1回目だけ navigation 以外の理由で失敗）を実ケースに注入し、修正前は通り、
  修正後は落ちることを確認する。
- 注入のたびに、実行後ファイルが pristine と同一であることを確認する。
