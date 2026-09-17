# fix-2103: ハーネスのナビゲーションだけ予算を持っていない

## 何が起きているか

`server/backends/sharedApp/headlessPreview.ts` は、ヘッドレス実行中の待ちを全部 `LIMITS` で
明示している（`evaluateMs: 5000` / `readyMs: 2000` / `settleMs: 600`）。例外が、その実行を
始めるナビゲーション:

```ts
// openHarness, 562 行
await page.goto(origin, { waitUntil: "domcontentloaded" });          // 指定なし
await page.waitForFunction("window.__preview !== undefined", { timeout: LIMITS.evaluateMs });
```

ここだけ puppeteer 既定の 30 秒を継承する —— **すぐ下の行がもらう予算の6倍**。`openHarness` は
3回リトライするので、ハーネスが読み込めないと**最大90秒の沈黙**のあとに、せっかく丁寧に書かれた
診断（「node は取れた／node も取れなかった」）が出ることになる。

到達経路はユーザーが待つ側: `manageSharedApp` → `narratePreview` → `headlessPreview(root)` →
`openDriver` → `openHarness`。

## ハングではない。それでも直す理由

止まりはしない（有界）。リトライも診断も良い。問題は、**このファイルが選んでいない数**が、
数を選ぶことそのものを規律にしているファイルの真ん中に座っていること。

receptron/mulmoclaude#3201 と同じクラス。あちらは継承した既定が**小さすぎて** flake になり、
リリース1周分の追跡コストを払った。こちらは**大きすぎて**、間違った答えではなく遅い答えになる。
向きが逆なだけで形は同じ。

## 直し方

`LIMITS.navigateMs` を足して `goto` に渡す。

**その上で、ループ全体を `LIMITS.harnessMs` で縛る。** 最初の版は「3回 × navigateMs が旧1回分に
収まる」と書いたが、これは**ナビゲーションだけの合計**で、呼び出し側が待つ時間ではなかった
—— 1試行は navigation + その後の待ち + 次までの間、なので3回で約45秒になり、`navigateMs` だけの
式は30秒と読めてしまう（CodeRabbit on #2104）。**一部の phase の予算から全体を約束したのが
間違い**だったので、ループは回数ではなく時計を見る: 残り時間に1試行が丸ごと入らなければ始めない。

判断は純関数 `roomForAnotherHarnessAttempt(elapsedMs)` に出して、両方向からテストする。

小さすぎる方向には倒さない —— 負荷のかかったランナーでローカルのバンドルを読むのに数秒かかることは
あり、`evaluateMs`（5秒）に合わせると上流で踏んだ「予算が小さすぎて spurious に落ちる」を
こちらで再現することになる。

## やらないこと

- **`puppeteer.launch` の2箇所**（`headlessPreview.ts:419`、`server/backends/markdown.ts:126`）。
  こちらも 30 秒を継承しているが、30 秒で起動しないブラウザは「遅い」ではなく「壊れている」ので、
  継承している数がそのまま選びたい数。触るついでがあるときに明示すればよい。
- **リトライ回数や診断の変更**。どちらも既にこのファイルの良い部分。

## 検証

- `LIMITS` の契約をテストで pin する: 各予算が正の有限値で、`navigateMs` が**継承していた 30 秒より
  小さい**こと（= 継承をやめた証拠）、1試行分が全体予算に収まること、そして
  `roomForAnotherHarnessAttempt` が境界の**両側**で期待どおり答えること。
  「回数 × navigateMs」で全体を主張するのはやめた —— それが最初に間違えた形。
- 既存のブラウザ実機テスト（`test/server/backends/headlessPreview.spec.ts`）が通ること。
  ハーネスが読み込めない経路そのものは実機テストしていない —— `openHarness` は非公開で、
  失敗させるには偽の Page を注入する必要があり、そのための seam を公開 API に足すのは
  この修正に見合わない。その旨は PR に書く。
