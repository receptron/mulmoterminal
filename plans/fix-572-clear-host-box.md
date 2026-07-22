# fix #572 — スマホから送るとき、ホスト側の入力欄に残った下書きと連結される

## 問題

`terminalInput.ts` は bracketed paste → 150ms 後に CR を書くだけで、入力欄に既にあるものを消しません。ホストで打ちかけた下書きが残っていると、スマホの文字がその後ろに連結されて送信されます（区切りの空白すら入らない）。

再現（使い捨ての tmux セッション）:

```
ホストの入力欄: yes I already typed this
スマホの送信:   ok
実際の送信:     yes I already typed thisok
```

#445 の時点からある挙動ですが、#563 / mulmoserver#98 のチップで「タップして送る」が主要操作になったぶん踏みやすくなりました。

## 実測に基づく解決策

実際の Claude / Codex の TUI に各キーを送って確認した結果:

| キー | 結果 |
|---|---|
| Ctrl-U | 表示 1 行分のみ。折り返した下書きは残る |
| Ctrl-U 繰り返し | 行頭で止まり、行をまたげない |
| Ctrl-A → Ctrl-K | 同じく行単位 |
| Esc | 消えない |
| **Ctrl-C** | **入力欄全体が 1 打で消える** |

さらに **Ctrl-C とペーストは 1 回の書き込みにまとめられる**（3 行にまたがる下書きでも `❯ ok` だけになる）。遅延の追加は不要で、既存の「CR は別書き込みで 150ms 後」はそのまま。空の入力欄に送っても no-op。Codex（キャレット `›`）も同挙動。

## 適用範囲

Ctrl-C は**ターン実行中に送ると中断させる**ため、「ホストがアイドルだと確実に分かっている場合」のみに限定する:

- **Claude セッションのみ** — `setWorking` を呼ぶのは Claude の activity hook だけで、codex の working 状態はホストが追跡していない。追跡していない以上アイドル判定ができない
- **shell は対象外** — プロンプトに居るのか長時間コマンド実行中なのか分からず、後者では実行中のプロセスを殺す
- **ターン実行中の Claude も対象外** — 従来どおり連結になるが、実行中に入力欄にあるのは「キューされたプロンプト」であり、黙って捨てる方が危険

codex の working 追跡が入れば、そのまま対象を広げられる。

## 変更

### `server/backends/remoteHost/terminalInput.ts`

```ts
export const CLEAR_BOX = "\x03";

export interface TerminalInputDeps {
  writeToSession: (sessionId: string, chunk: string) => boolean;
  // 入力欄を安全に空にできるか。省略時は false（＝従来どおり上に重ねてペースト）。
  canClearBox?: (sessionId: string) => boolean;
  scheduleSubmit?: (submit: () => void) => void;
}
```

ペーストのチャンクを `${clear}${PASTE_START}${safe}${PASTE_END}` にするだけ。省略可能なので既存の呼び出し・テストの挙動は変わらない。

### `server/index.ts` の配線

```ts
const remoteHostCanClearBox = (sessionId: string): boolean =>
  ptys.get(sessionId)?.agent === "claude" && activity.get(sessionId)?.working !== true;
```

`handlers.ts` / `remoteHost/index.ts` の deps 型も追随。

## テスト

- `canClearBox` が true のとき、ペーストと**同じ 1 回の書き込み**で Ctrl-C が先行すること
- false のとき（ターン実行中 / codex / shell / dep 省略）先行しないこと
- スマホの文字自体に Ctrl-C を混ぜても `sanitizeTerminalInput` が落とすので、我々が付けた 1 個だけであること
- 既存の直列化・失敗時のチェーン維持の回帰テストが通ること
