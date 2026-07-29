# chore(types): exactOptionalPropertyTypes を有効にする (#1048)

## なぜ

`SessionDetail.work?: SessionWorkSummary` は optional なのに `{ work: undefined }` が型検査を
通り、その `undefined` が Firestore まで届いてスマホの一覧が全滅した (#1042)。
「optional = キーが無い」を型で言えていない。`exactOptionalPropertyTypes` はそれを言える
唯一の手段で、`field?: T` を「キーが無いかもしれない」に、`field?: T | undefined` を
「キーはあるが undefined かもしれない」に分ける。

#1044 の実行時ガード (`firestoreSafeHandlers`) が守るのは Firestore へ向かう経路だけで、
それ以外の undefined 混入は今も素通りする。

## スコープ

4 つの tsconfig すべて。`tsconfig.test.json` / `tsconfig.test-server.json` は
app / server の設定を extends するので、フラグは自動的に specs にも効く。

| tsconfig | 有効化直後のエラー |
| --- | --- |
| `tsconfig.server.json` | 31 |
| `tsconfig.test-server.json`（server + specs） | 36 |
| `tsconfig.app.json` | 19 |
| `tsconfig.test.json`（app + specs） | 48（うち 28 件は `notifyKind.spec.ts` の `msg` ヘルパー 1 つ由来） |

## 前提条件: `sonarjs/no-redundant-optional` を外す

このルールは**フラグが OFF である前提**（`?: T` が既に `| undefined` を含む）で書かれている。
フラグ ON では `?: T` と `?: T | undefined` は別の意味なので、ルールの前提が成り立たない。
「undefined が正常な値である」と書く唯一の綴りを禁止してしまうため、`eslint.config.js` で
off にする。フラグを外すことがあれば戻す、と理由をコメントに残す。

## 直し方の判断基準

`undefined` の入ったキーが見つかったとき、2 つの直し方がある。どちらを選ぶかを
サイトごとに決め打ちせず、次の基準で分ける。

1. **キーの有無が意味を持つ境界を越えるなら、キーごと落とす。**
   Firestore の書き込み、条件付きスプレッドでマージされるオブジェクト、
   published package が `?: T`（exact）で受け取るパラメータ。
2. **それ以外は宣言側に `| undefined` を足す。**
   「このフィールドは値が無いことがある」が実際の仕様である場合。
   `obj.field = maybeUndefined` のような代入は、`delete` を書かない限りキーを落とせないので
   必然的にこちら。

「#1042 と同じ形」＝ 1 のケース。キーを落とす修正はフラグと無関係に価値があるので
#1053 で先行してマージ済み。

## 外部パッケージとの境界

相手の型が `?: T`（exact）で、こちらが `T | undefined` を渡している箇所。
相手の型は変えられないので、呼び出し側で条件付きスプレッドにしてキーを落とす。

- `server/backends/collections.ts` — `ActionWithWhen` (@mulmoclaude/core)
- `server/backends/remoteHost/googleCalendar.ts` — `CalendarEventInput` / `ListEventsInput` (@mulmoclaude/core/google)
- `server/infra/collection-tool.ts` — `ToolDefinition` (gui-chat-protocol)
- `src/components/RemoteHostControl.vue` — `RequestInit` (lib.dom)
- `test/server/backends/imageResult.spec.ts` — `Blob_2` (@google/genai)

issue のコメントでは `LoadedCollection → FeedLike` も「core 側が変わらないと閉じない」と
していたが、`FeedLike` は `server/backends/feed-summary.ts` にある**このリポジトリの型**
だった。宣言に `| undefined` を足すだけで閉じる。

### 罠: 条件付きスプレッドはゲートを落としうる

`server/backends/collections.ts` の `actionVisible(action, record)` は**認可チェック**
（クライアントは状態外のボタンを隠すが、細工したリクエストは届きうる）。core の
`ActionWithWhen` は `when` と `require` の 2 つを見る — **同じゲートの 2 つの綴り**で、
`when` が chat/agent、`require` が mutate に付く。

当初 `when` だけを転送する形で書いたが、それでは `kind: "mutate"` のアクションが
**無条件に実行可能**になる。`visibilityGate` として切り出し、両方を転送する形に修正した上で、
`require` が生き残ることを spec で固定した（`test/server/backends/collections.spec.ts`）。

外部型に合わせてキーを落とすとき、**落としているのが本当に「値の無いフィールド」なのか、
それとも意味を持つゲートなのか**を確認すること。

### 1 か所だけ、キャストが必要

`server/routes/mcp-routes.ts` の `server.connect(transport)` は上流の型バグに当たる。
`@modelcontextprotocol/sdk@1.30.0`（npm 最新）は

- `shared/transport.d.ts` — `interface Transport { onclose?: () => void }`（exact）
- `server/streamableHttp.d.ts` — `class StreamableHTTPServerTransport implements Transport`
  だが `set onclose(handler: (() => void) | undefined)`

と書いており、**`implements Transport` と宣言しているクラス自身がその interface を
満たしていない**。SDK はフラグ無しでビルドされているので上流では顕在化しない。
兄弟クラス `WebStandardStreamableHTTPServerTransport` は `onclose?: () => void` と
正しく書かれているので、Node 互換ラッパー側の宣言バグ。

上流に **open の issue が既にある**（[modelcontextprotocol/typescript-sdk#2083]）。
回避策として「connect 呼び出し側での限定的なキャスト」がそこに明記されているので、
新規起票はせず、それに従う。`as unknown as Transport` 1 か所、理由と issue URL を
コメントに残し、上流が直り次第外す。

[modelcontextprotocol/typescript-sdk#2083]: https://github.com/modelcontextprotocol/typescript-sdk/issues/2083

## `undefined` を意図的に作るテストの扱い

#1042 のガード（`buildSessionList` / `firestoreSafeHandlers` / `stripUndefined` /
`definedScreenMeta`）は「呼び出し側が `undefined` を入れてしまった」場合を防ぐものなので、
その回帰テストは**フラグが禁じた値をわざと作る**必要がある。テストを消さずに済ませるため、
入力型と出力型を分けた。

| 入力（undefined 可） | 出力（キーが無い） |
| --- | --- |
| `SessionDetailDraft` | `SessionDetail` |
| `SessionActivityInput` | `SessionActivityDoc` |
| `ScreenMetaDraft` | `SessionScreenMeta` |

これは型を緩めた妥協ではなく、コードが実際にやっている層構造を型で言い直したもの。
`ClaudeArgsInput.appendedPrompt` は `string | null | undefined` に広げたが**キーは必須のまま**
なので、#1062 の「どの spawn 経路も書き忘れられない」保証は保たれる。

## 検証

`yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn typecheck:server` /
`yarn typecheck:test` / `yarn test` をすべて通す。`typecheck` だけでは specs が
コンパイルされないので、3 つ全部を回す。
