# feat: コレクションを見たまま、下のターミナルでチャットを進める (#2001)

## 問題

コレクションのカードやテンプレートからチャットを起動すると、`startCollectionChat` →
`placeSpawnedChat` がセッションをグリッドセルとして置き、`/terminals` へ移る。読んでいた
コレクションはその場で閉じる。「コレクションを見ながら、その内容についてエージェントに少し
手を動かしてもらう」が、毎回**画面ごと**切り替わる。

## 制約（実コードで確認済み）

- 配置は `registerSpawnedChatHandler` という**登録式の seam**。ただし `handlerQueue` は
  **ハンドラを 1 つしか持たない**ので、ここに登録すると GridView のものが外れ、外れたままになる
  （グリッドの登録は activate 時）。→ **同じ seam には登録しない**。
- サーバは **1 セッション 1 ソケット**。新しい attach は前のソケットに `superseded` を送って閉じる
  （`server/session/pty-connection.ts:103-111`）。クライアントは superseded の後、意図的に自動
  再接続しない（`reconnectPolicy.ts`）。→ **ペインとセルで同時に生かすことはできない**。

## 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 所有 | ペインは**一時的な預かり所**。所有は分けない | 1 セッション 1 ソケットなので「2 つの生きたビュー」は作れない |
| 紐づけ先（**改訂**） | オーバーレイではなく、**コレクション**（`project|kind:slug`、index も 1 つの場所） | 実際に使うと、オーバーレイに紐づける形は 2 つとも壊れていた: ①別のコレクションに移ってもペインが開きっぱなし ②グリッドに行って戻ると消えている。チャットはそのコレクション**について**のものなので、そこに file する |
| オーバーレイを閉じたとき（**改訂**） | **何もしない**（file されたまま残る） | これが②の直接の原因だった。グリッドへ渡すのは「Move to the grid」を押したときと、同じコレクションで 2 本目が始まったときだけ |
| 復帰 | セッション id で durable slot（`persistKey`）を張る | 戻ってきたときに再接続して描き直すのではなく、**離れたときの端末がそのまま**出る |
| 受け渡し | 手放すのは「Move to the grid」と、同じコレクションで 2 本目が始まったときだけ。そのとき **同じ request を `placeSpawnedChat` に渡す** | 走っているエージェントを画面の無い状態にしない。**閉じただけでは渡さない**（渡していたのが②の原因） |
| seam | grid の seam の**手前**に別の claim を置く | 上記のとおり同じ seam に登録すると grid の登録を外してしまう。claim が無ければ従来どおりの経路 |
| 同時に複数 | ペインが持つのは 1 本。次が来たら**前のものをグリッドへ渡してから**受け取る | 走っているエージェントを黙って画面から消さない |
| 位置 | **下**。高さはドラッグで可変、localStorage に保存 | コレクションのカードは横幅を食う。既存のスプリッタ幾何（`splitterWidth.ts`）に 5 本目として乗せる |
| 見た目 | 薄いヘッダー（エージェント名 + 「グリッドへ」）+ `hideHeader` の Terminal | 「簡素な terminal」。セルのクローム一式は要らない |
| ボタン | 閉じる（×）ではなく「**グリッドへ**」 | セッションは生きている。閉じるとしたら行き先はグリッドしかないので、そう書く方が正直 |

## 実装

- `src/composables/collectionChatPane.ts`（新規）— claim / offer だけの seam。
- `src/components/CollectionChatPane.vue`（新規）— claim の登録、いま見ているコレクションの
  セッションの表示、durable slot、スプリッタ。`onBeforeUnmount` は claim を外すだけ。
- `src/composables/collectionChatSessions.ts`（新規）— コレクション ↔ セッションの対応。
  `collectionChatKey` は純関数（index / kind / slug / project を 1 つのキーに）。
- `src/composables/useChatLauncher.ts` — `placeSpawnedChat` の前に `offerCollectionChat` を挟む。
- `src/components/CollectionsBrowseOverlay.vue` — ペインをマウント。
- `src/components/splitterWidth.ts` — `TERMINAL_COLLECTION`（5 本目の床）。

## 検証（改訂後）

ユニットに加えて、**実際に動かして確認する**（CLAUDE.md の「blast radius が広い変更」）。
専用の `HOME` / ワークスペース / ポート 34599 でサーバを起動し、Playwright で:

1. Collections → 「+ Collection」→ テンプレートカードを押す →
   **route は `/collections` のまま、オーバーレイも開いたまま、下にペインが出て Claude が動く**。
2. そこから「Grid view」を押す → **route `/terminals`、ペインは消え、グリッドに同じセッションの
   セルが 1 つ**（同じ出力・同じ作業ディレクトリ）。
3. console エラー 0。

改訂後は、上に加えて実機で 5 点:

1. index でチャットを起動 → ペインに出る
2. **Feeds へ移動 → ペインが閉じる**（別の place なので）
3. **Collections へ戻る → 同じセッションが戻る**
4. **Grid view へ → グリッドの端末は 0**（渡していない）
5. **Collections へ戻る → まだそこにある**（スクロールバックごと）

## やらないこと

- 右ペイン版（下で始める）。
- ペインからのセッション終了・再起動（グリッドに渡してからセルの機能を使う）。
- コレクション以外から始まったチャット（skill ボタン等）は従来どおりグリッドへ。
