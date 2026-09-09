# fix: `/clear` した会話が、次の接続で `--resume` されて復活する (#2013)

## 症状（報告 → 実機で再現）

`/clear` したセルが、PC 再起動後に開き直すとクリア前の会話ごと復活する。入力するとその会話が
丸ごと再送されるので、実害はトークン（報告では 1 ターン 478,237 tokens）と、同じ transcript が
再起動のたびに積み上がること（報告では 11 日ぶん 9.7MB / 合計 175MB）。

**この手元でも再現した**（tmux あり・Windows 以外でも成立する）:

1. 使い捨て `HOME` に、凍結された transcript（`~/.claude/projects/<enc>/<id>.jsonl`）と
   `~/.mulmoterminal/cleared-transcripts/<id>.json`（`{cwd,size}` が現在サイズと一致）を置く
2. サーバ起動（`hydrateClearedTranscripts` が印を復元する）
3. `ws://…/ws?session=<id>&cwd=<ws>` で接続
4. → `[ws] client connected (resume <id>)` / `[pty] started claude … — resume <id>`

## 原因（コードを辿って確認）

```text
/ws 接続 → resolveClaudeSession()            server/routes/ws-routes.ts:119
        → facts { hasLivePty, tmuxAlive, onDisk }   ← onDisk は sessionExistsOnDisk() だけ
        → resolveSession()                    server/session/session-resolve.ts:29
        → resume = requested （onDisk なので）
        → spawnClaudePty(sessionId, resume)   server/session/spawn-claude.ts:206
        → canResume = sessionExistsOnDisk()   → `--resume <id>`
```

`/clear` は claude 側に新しい session id を発行させ、こちらのキーの `<id>.jsonl` は**凍結**される。
その事実は `clearedTranscripts`（#1085、`~/.mulmoterminal/cleared-transcripts/` に永続化され boot で
hydrate される）が持っているのに、**resume の判定はそれを見ていない**。読んでいるのは、サマリー /
タイトル / transcript ビュー / プロンプトペインだけ（`grep clearedTranscripts`）。

`cleared-transcripts.ts` の冒頭は、印を永続化する理由を「tmux がプロセスを生かしたままサーバだけ
再起動する窓」と説明している。tmux の無いホストでは、その窓は「PC 再起動から次に開くまで」という
もっと長いものになる — 印は正しく残っているのに、その窓でだけ参照されない。

## 直し方

**事実を直す。** 「ディスクに transcript がある」ではなく「**resume してよい** transcript がある」を
`resolveSession` に渡す。判定はすでに純関数で切り出されているので、そこに `cleared` を足す。

| | 決定 | 理由 |
|---|---|---|
| どこで弾くか | `resolveSession`（純関数）に `cleared` を足す | `canResume`（spawn-claude）だけ直すと、`resolveSession` はキーを再利用したまま `--session-id <id>` で起動し、**claude が "Session ID is already in use" で落ちる**（同ファイルのコメントが警告している通り）。id を振り直すところまで含めて 1 つの決定 |
| tmux が生きている場合 | **id は維持するが resume は渡さない**（改訂: Codex #2014） | 当初は「従来どおり resume」にしていたが、`tmuxAlive` は probe でしかない。spawn までにその tmux が死ぬと `tmux new-session -A` がコマンドを実行し、そこで `--resume` は**凍結された会話を黙って復活させる** — この PR が止めようとしているものそのもの。`--session-id` で claude が拒否して落ちる方を選ぶ: 次の接続では tmux が無いので新しい id になり、素の状態で立ち上がる |
| tmux が無い / 死んでいる場合 | resume しない → `sessionId` は新しい id | 報告のケース。素の状態で立ち上がる |
| 凍結 transcript | **消さない** | 消すのは別の話。#1085 のサマリー等はこの印と凍結ファイルを読んでいる |

```ts
// session-resolve.ts
const resume = !reattachId && requested && facts.onDisk && !facts.cleared ? requested : null;
```

呼び出し側（ws-routes）は `cleared: clearedTranscripts.has(requested)` を足すだけ。

## やらないこと

- **クリア後の会話（claude 側の新しい id）を代わりに resume する**こと。印は `claudeId` を持って
  いるので技術的には可能だが、セルが担う会話が変わるうえフックの id 対応にも触れる。別の提案。
- 凍結 transcript の掃除（報告者はスクリプトで退避している）。サイズの問題は本質的には別 issue。
