# 再起動をまたいだセッションで「このディレクトリで新規ターミナル」が失敗する (#2181)

> この計画は実装後に一度だけ書き直しています。最初の版は「1式の変更」と書いていましたが、
> レビューで2つの穴が見つかり、最終形はそれより広くなりました。どこがなぜ広がったかを残します。

## 実在の確認（推測ではなく、入口からの1本の呼び出し鎖）

1. 電話がセッション一覧を引く → `listTerminalSessions()`。一覧は `tmuxListSessionIds()` の生き残りを
   **含み**、各行の `cwd` は `cwdOfSession(id)` = `ptys.get(id)?.cwd ?? sessionCwd(id) ?? ""`。
   つまり **PtyEntry が無くても記憶された cwd が出る**。
2. 電話がその行で「ここで新規ターミナル」を押す → `launchTerminal(agent, sessionId)`。
3. そこだけ `cwdOf: (id) => ptys.get(id)?.cwd ?? null` で、生き残りには `PtyEntry` が無いので `null`。
4. `decideLaunchTerminal` の `if (!cwd)` が断る。

**入力を供給しているのは手順1の一覧そのもの**で、そこには dir が表示されている。
tmux はサーバ再起動を設計上生き延びるので、これは**再起動のたびに起きる**。

修正前のコードに対して spec を走らせ、`expected { ok: false } to deeply equal { ok: true }` で
**再現してから**直した。

## 最終的に何をしたか — 3層

**1. 規則が読む事実を正す（#2181 そのもの）。** `cwdOf` を、一覧と同じ `cwdOfSession` にする。

**2. 記憶された cwd は、そのセッションが存在する間だけ有効（レビュー1巡目）。**
記憶ログは append-only なので、何週間も前に消えた id にも答え続ける。電話の一覧は
「生きた pty ∪ tmux」から作られるので、ログにだけ残る id は一覧に出ない。つまり 1 だけでは
「電話が見える集合」より広いディレクトリを開けてしまい、
*The phone sends a session id, never a path* という約束を破る。
`decideLaunchTerminal` に `sessionExists` を足し、**ディレクトリを見る前に**専用の文言で断る。

**3. 存在確認は exact でなければ意味がない（レビュー2〜3巡目）。**
`tmux has-session -t NAME` は**名前が NAME で始まるだけ**のセッションにヒットする。実測（tmux 3.6a）:

```
sessions: mt-<uuid>-suffix
  has-session     -t 'mt-<uuid>' -> exit 0   ← 完全な uuid ですら前方部分になりうる
  capture-pane    -t 'mt-<uuid>' -> exit 0   ← 画面が返る
  display-message -t 'mt-<uuid>' -> mt-<uuid>-suffix
```

前方一致は `has-session` 固有ではなく `-t` の族すべて。そこで**到達可能性を論じるのをやめ**、
プローブを捨てて `tmuxHeldSessionIdsAsync()` が返す**実際の名前と突き合わせる**。
列挙して比較するので前方一致が原理的に起きない。`null`（tmux 不在・読めない）は
**「セッションが無い」ではなく「存在を証明できない」**なので拒否に倒す。
非同期になったのは副産物ではなく要件で、`tmux.ts` 自身が「リクエストはこの async 形を使え」と書いている
（sync 版はイベントループを止める）。

## 範囲 — 調べたうえで置いたもの

- **hydration の await は入れない。** `sessionCwd()` はブート時の hydrate の窓で空を返しうるが、
  **この経路では到達不能**。`devTerminalCwdsHydrated` はモジュール評価時に1ファイルを読む IIFE で
  数ミリ秒で解決し、Firestore runner はブラウザの Connect 操作でしか始まらない。
- **`canClearBox` / `submitSequence` / `sessionAgent` は生の `ptys.get(id)?.agent` のまま。**
  同じ形だが別の規則で、`submitSequence` は PTY に届く**バイト**を決めるため、
  生き残りを「undefined」から「tmux が言うエージェント」へ動かすのは実挙動の変更。
- **`hostScreens.ts` の `cwdOf` は `?? ""` のまま。** 欠けることをコメントが意図として書いており、
  記憶された cwd を使うと電話がポーリングする画面で毎回 git を叩くことになる。
- **`tmux.ts` のヘルパ群は前方一致のまま → #2192。** `kill-session` を含め8箇所以上あり、
  再アタッチ判定も通るので、独立した PR と実機確認が要る。
  **`getTerminalScreen` が id を検証していない**ことも同じ issue に記録した
  （電話は id の前方部分だけで他セッションの画面を読める）。これは既存の穴で、別コマンド。

## テスト

欠陥は**配線**にあったので、純粋関数だけの spec では捕まらない。3層に分けた:

- `launchTerminal.spec.ts` — 規則（`sessionExists` が false のときの文言、cwd との優先順）
- `hostBindings.spec.ts` — 配線（`initRemoteHostBackend` を mock して deps を捕まえ、そこから駆動）
- `handlers.spec.ts` — コマンド層（拒否が**throw になる**こと。ならないと電話は「開いた」と言われる）

すべて break-verify 済み。どの mutation がどれだけ赤にするかは PR 本文に記載。
