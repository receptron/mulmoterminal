# #1078 — 起動と終了について、サーバが何をしたのかをログに書く

#1063 の調査で分かったのは「起動しない」を追う材料が無いということだった。#1068 で
spawn 前のバイナリ診断は出るようになったが、残り 3 つはまだ見えない。この変更は
**報告を足すだけ**で、起動の可否そのものは 2 の一点でしか変えない。

## 決定

### 1. attach と create をログで区別する

`tmux new-session -A` は同名セッションがあれば attach し、**コマンドを実行しない**。実測:

```
$ tmux new-session -d -s demo -- sh -c 'echo FIRST; sleep 60'
$ tmux new-session -A -d -s demo -- sh -c 'echo SECOND; sleep 60'
$ tmux capture-pane -p -t demo
FIRST          <- SECOND は実行されていない
```

つまり生きた tmux セッションへの resume は、claude / codex を一度も起動しない。PATH も
argv も cwd も壊れたまま成功する。#1063 で「resume は動くのに新規だけ落ちる」が切り分けに
ならなかった理由がこれで、ログが両方を `spawned` と書いていたせいで後から判別もできなかった。

答えは `ptyWouldReattach()` として既に計算済み。`ptySpawn` の戻り値に `reattached` を足して
報告するだけで、新しい判定は増やさない。

**正確さの限界を書いておく**: 判定と `new-session -A` の間に tmux セッションが死ぬ窓は残る。
これは決定ではなく報告なので、まれな取り違えは受け入れる（#1068 が同じ窓について
`resetToolGroupsUnlessReattaching` で書いているのと同じ理由）。

### 2. cwd を spawn 前に診断する

macOS では、存在しない cwd は例外にならない。`chdir` は子で走るので `_exit(1)` になるだけで、
tmux 経由なら alt-screen の復帰でペインの出力も消える。#1068 はバイナリだけを見ていた。

`server/infra/spawn-cwd.ts` を has-binary.ts と同じ形で置く:

- 断定できるときだけ `missing` / `not-a-directory` を返す
- stat が答えられないとき（権限、壊れたマウント）は `ok` — **答えられない preflight が
  「駄目」と言ってはいけない**という #1068 のルールをそのまま引き継ぐ
- 相対パスも素直に stat してよい。子は親の cwd を継いでから `chdir` するので、基準は
  こちらの cwd と同じ

**拒否するのは新規起動のときだけ**。attach のときは cwd が死んでいても警告を出すに留める:
ディレクトリを消したせいで、まだ生きているセッションに戻れなくなるのは直したい不具合より悪い。

**どこで効くのかを正直に書いておく**。`/ws` は `resolveWorkspace` で既に `?cwd=` を検証していて、
駄目なら `CLAUDE_CWD` に落とすので、そちらから来る限りこのチェックはほぼ発火しない。効くのは
検証を通らない残りの経路:

- `spawnBackgroundChat` / collection アクション / plugin-routes — cwd を渡さず `CLAUDE_CWD` を使う
- その `CLAUDE_CWD` 自体が消えている場合。起動時にも検証していないので、いまは全セッションが
  無言で死ぬ。報告された症状とまったく同じ形で、これを 1 文にするのがこの項目の主目的
- `?cwd=` の検証と spawn の間にディレクトリが消える窓

### 3. 終了ログを 1 つの共有ヘルパーにまとめる

いまは claude / codex / launcher / command の 4 か所が、少しずつ違う同じ行を書いている。
`server/session/pty-exit-log.ts` に開始行と終了行の 2 つを置き、4 か所がそれを呼ぶ。

終了行に足すのは agent・session id・cwd・**寿命**。寿命が要る理由は、spawn の 40ms 後に死んだ
のは起動失敗で、1 時間後に死んだのはユーザが `/exit` したからで、いまは同じ 1 行だから。
起動直後（`STARTUP_WINDOW_MS`）の異常終了は、そう書く。

## やらないこと

- ブラウザ側の表示は変えない。#1068 で `[session ended — exit 1]` になっている
- 起動の可否は、2 の「新規起動で cwd が確実に無い」以外では変えない
