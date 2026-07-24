# feat: 空グリッドと設定画面にユーザーガイドへのヘルプリンクを追加

## 背景

初めて使うユーザーが「使い方がわからない」ときに、アプリ内から
ユーザーガイド（`receptron.github.io/mulmoterminal`）へたどり着く導線がなかった。
グリッドビューでターミナルが1つも起動していない状態と、設定画面に
ヘルプリンクを置く。

## 方針

日本語 / 英語のガイド着地ページへのリンクを共通コンポーネント化し、
2箇所（空グリッドのフッター・設定モーダル）で再利用する。ロケール自動判定で
片方だけ出すのではなく、両言語をそれぞれの言語名（日本語 / English）で
自己ラベル表示する — 読める方をユーザー自身が選べる（README と同じ方式）。

リンク先:
- 日本語 → `https://receptron.github.io/mulmoterminal/guide/ja/`
- English → `https://receptron.github.io/mulmoterminal/guide/en/`

## 実装

1. `src/components/GuideLinks.vue`（新規・共通コンポーネント）
   - 「📖 Not sure how to use MulmoTerminal? Read the guide — 日本語 · English」の
     1行ヒント。リンクは別タブ（`target="_blank" rel="noopener noreferrer"`）。
2. `src/components/GridView.vue`
   - `noRunningTerminals = runningCount(cells) === 0`（起動中ターミナルが無い＝
     entry launch cell だけの状態）を computed で判定。
   - `TerminalGrid` の下に、`noRunningTerminals` のときだけ `<GuideLinks>` のフッターを表示。
     ターミナルが起動した瞬間に消える。
3. `src/components/SettingsModal.vue`
   - 末尾（Cost セクションの後、Close の前）に「Help & user guide」セクションを追加し
     `<GuideLinks>` を配置。両シェル（グリッド／チャット）が同じモーダルを開くため両方に効く。
4. テスト `test/src/components/GridView.spec.ts`
   - ターミナル未起動時にフッター（ja/en リンク）が出て、起動中セルがあると消えることを検証。
     ガード反転で red になることも確認済み。

## 検証

- `yarn format` / `yarn lint`（0 errors）/ `yarn build`（vue-tsc 含む）/ `yarn typecheck` — すべてグリーン。
- `yarn test` — 全パス（GridView に回帰テスト1件追加）。
- 新 SFC が実 Vite dev パイプラインでコンパイルされることを確認（HTTP 200）。
- README は既に同ガイド URL を記載済みのため変更不要（アプリ内導線を足しただけ）。
