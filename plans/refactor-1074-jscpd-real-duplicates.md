# refactor(#1074): jscpd が報告している重複のうち、本物の3件を潰す

Code scanning の jscpd アラート 10 件を、ローカルで同じスキャンを走らせて**両側**を突き合わせた
結果（アラートは片側しか出ない）。**本物は3件、残り7件は既に共有済みのものの呼び出し側**。

`plans/refactor-jscpd-duplicates.md` の方針をそのまま引き継ぐ: 本当に抽象が欠けている重複だけ
潰し、偶然の一致は残す。**誤った抽象は重複より悪い。**

## 1. `isRecord` / `finiteNumber` の手書きコピー（alert #110）

`common/isRecord.ts` は「29ファイルにコピペされていたのを一本化した」と自分で書いている。
その手書きが5ファイルに残っていて、しかも**中身が違う**。

```ts
// ローカル版（5箇所）— 配列を通す
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
// common/isRecord.ts — 配列を意図的に弾く
export const isRecord = (value) => isObject(value) && !Array.isArray(value);
```

共有版が配列を弾く理由もそこに書いてある: 配列を `Record` に narrow するのは**型に嘘をつく**
行為で、`Object.entries()` する呼び出し側が添字をフィールド名として歩く。

**実害の有無は確認済み: 現時点では無い。** 各呼び出しを追ったところ、配列が来ても

- `parseRateLimitCache` → `parsed["claude"]` が `undefined` → 空を返す
- `useRateLimits.load` → `data.claude` が `undefined` → 空の snapshot

となり、結果は厳しい版と同じ。**直す理由は将来の実害ではなく、一本化したはずのものが戻りかけて
いること。**

対象:

| ファイル | `isRecord` | `finiteNumber` |
|---|---|---|
| `server/agents/statusline.ts` | ○ | ○ |
| `server/agents/codex-rate-limits.ts` | ○ | ○ |
| `server/agents/rate-limit-persist.ts` | ○ | ○（`finite` という名） |
| `src/composables/useRateLimits.ts` | ○ | — |
| `common/rateLimits.ts` | ○ | ○ |
| `src/composables/useCost.ts` | — | ○（`undefined` を返す変種） |

方針:

- `isRecord` は5箇所すべて `common/isRecord.ts` に寄せる。クライアントは既に10箇所以上で
  これを import しているので bundle 都合の分離ではない。
- `finiteNumber` は `common/` に置いて共有する。**`useCost.ts` の変種（`undefined` を返す）は
  別物**なので無理に畳まない — `null` と `undefined` はこのコードベースで意味が違う。
- 置き換え後、**配列を渡したときの挙動が変わらないこと**をテストで固定する（厳しい版に変える
  以上、それが唯一の観測可能な差分）。

## 2. `server/backends/html.ts` の自己重複（alert #120）

HTML を返す2経路が、それぞれ Content-Type / `X-Content-Type-Options: nosniff` /
`Content-Security-Policy` / stream を書いている。**片方が CSP を落としても誰も気づかない。**

`sendHtmlDocument(res, abs)` に寄せ、ヘッダ3種と stream を1箇所にする。`statFileOr404` の
呼び出しも同じ形なので一緒に入れるか、呼び出し側に残すかは実装時に読みやすい方を採る。

## 3. `server/routes/ws-routes.ts` の起動＋配線（alert #119）

launch と codex の2経路が同じ手順を書いている:

```
entry を起動 → 失敗ならログ・early.discard()・closeWithError
→ ws.on("message") / ws.on("close") を配線 → early.release(...)
```

差分は**起動関数・ログのタグ・エラー文言だけ**。しかも codex 側にだけ「本物の listener を
張った後だから、replay 中に届いたフレームでも順序が保たれる」というコメントがあり、launch 側に
は無い。**不変条件が片側にしか書かれていない**のが、この重複の一番の害。

`startAndWire(deps, ws, { sessionId, early, tag, failureMessage }, start)` に寄せ、順序の理由を
そこに1回だけ書く。

## 残すもの（意図的）

- **Vue の6件**（#112 #113 #114 #115 #116 #102）— すべて**既に共有済み**のコンポーネント /
  コンポーザブルの呼び出し側。`CellChromeButtons` の props/emit 転送（CommandCell /
  LauncherCell / TerminalCell）、`useSessionFilter` の定型（SessionTabBar / Sidebar）、
  `TerminalGrid` の TerminalCell / LauncherCell 呼び出し。これ以上畳むと「emit を props で
  渡すな」というルールと衝突し、どのイベントがどこへ行くのかも追えなくなる。
- **`ws-routes.ts` の #118** — 並行した構造だが `markDevTerminalSession` の条件も
  `registeredGuiMcpGroups` の取り方も違う。パラメータ化すると分岐だらけの関数になる。

## 制約

純粋なリファクタで**挙動は変えない**。`yarn format` / `lint` / `typecheck` ×3 / `build` /
`test` が green であること。

`isRecord` の置き換えだけは観測可能な差分がある（配列を弾くようになる）ので、そこはテストで
現行挙動が保たれることを示す。
