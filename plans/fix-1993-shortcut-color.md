# fix: 共有 shortcuts.json から MulmoClaude の `color` が消える (#1993)

## 問題

`<workspace>/config/shortcuts.json` は MulmoClaude と共有している。MulmoClaude はピンに
`color`（アクセント色）を持たせて保存し、`PluginLauncher.vue` / `ShortcutReorderPopover.vue` で
実際に描いている。

MulmoTerminal 側の `normalizeShortcuts`（`server/backends/shortcuts.ts`）は、読み込んだレコードを
`{kind, slug, title, icon}` の**新しいオブジェクトに組み立て直す**ので、`color` が落ちる。
読み（GET で配信する前）と書き（PUT でディスクに書く前）の両方に効くため、
**MulmoTerminal でピン留めを 1 回でも操作すると、全エントリの色が消える**。

意図ではなくドリフト: `common/shortcuts.ts` の冒頭に「Keep this type in sync with MulmoClaude's」と
書いてある。

影響は見た目のみで、MulmoClaude 側の `reconcile` が index を開いたときに貼り直すので自己修復もする。
それでも「MulmoTerminal を触るたびに色が飛ぶ」往復は残る。

## 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 直し方 | `common/shortcuts.ts` の `Shortcut` に **`color?: string`** を足し、`normalizeShortcuts` で通す | 共有ファイルの契約は「MulmoClaude の型と同期」。相手の型をそのまま持つのが最小で、最も素直 |
| 値の検証 | **しない**（文字列であることだけ見る） | パレットを持っているのは MulmoClaude 側（`isAccentColor`）。こちらが妥当性を判断すると、**判断がずれた瞬間に同じ「黙って消える」が再発する**。描かない側が捨てる理由がない |
| 未知キー全部を保持する案 | **採らない**（PR に follow-up として書く） | 片側だけ直しても、MulmoClaude の `toShortcut` も同様に組み立て直すので、こちらが足したキーは向こうで落ちる。両リポジトリにまたがる変更で、この issue の範囲ではない |
| UI | 触らない | MulmoTerminal は色を描かない。持って返すだけ |

## 実装

- `common/shortcuts.ts` — `color?: string` を追加（なぜ検証しないかをコメントに残す）。
- `server/backends/shortcuts.ts` — `normalizeShortcuts` が `color` を拾う。空文字は付けない
  （`color: undefined` を JSON に出さないための条件付き追加。MulmoClaude 側と同じ扱い）。
- `test/server/backends/shortcuts.spec.ts` — 以下を固定する:
  - `normalizeShortcuts` が `color` を残す / 文字列でない `color` は落とす。
  - **ファイル往復**: `color` 付きのファイルを置いて GET → そのまま PUT → ディスクの `color` が残る
    （これが実際に壊れていた経路）。

## 確認すること

- MulmoClaude 側で色付きのピンを作り、MulmoTerminal で別のものをピン留め／解除しても色が残ること。
- MulmoTerminal 自身は色を読まないので、UI の変化が無いこと。
