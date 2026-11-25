# fix #3507: 課題を作るセルで auto mode を選ぶと保存できない

## 原因

auto mode では、作業ディレクトリの外への書き込みが一回ごとに auto mode の判定（classifier）に回る。課題を作るセルの保存先 `~/.mulmoterminal/skill-evals/<skill>/` はセルの作業ディレクトリ（プロジェクトか home）の外なので、保存が判定しだいになり、拒否されることがある。シェルの heredoc で JSON を書くと、別の安全チェックでも止まる。

手元で `claude --permission-mode auto` を使って確かめた:

- 規則なし: Write ツールの書き込みごとに `Allowed by auto mode classifier`（判定に回っている）。
- `--add-dir <保存先>`: 同じく判定に回る。直らない。
- `--allowedTools 'Write(//<保存先>/**),Edit(//<保存先>/**)'`: 判定に回らずに書ける。

## 変更

- `server/backends/skillEval/evalWriteRules.ts`（純粋）: 保存先から `Write(//…/**)` と `Edit(//…/**)` を作る。Windows のドライブは `/c/…` にする。コンマや括弧を含む、相対、ルート（Windows はドライブのルートも）なら規則を作らない（判定に戻るだけで、広く許すことはない）。
- 課題を作るセルの起動（`startAuthoring`）で、それを `claudeAllowedTools` として渡す。`IssueSessionOptions.claudeAllowedTools` → `issueSpawnOptions` → `SpawnClaudeOptions.extraAllowedTools` → `--allowedTools` に足す。その起動だけで、id には記録しない（再開では付かない）。
- 同梱スキル `mulmoterminal-skill-eval`: 保存はファイルを書く道具で行い、シェルで書かないよう書き直した。
- ガイドのスキルの評価のページ: 「2 番を選べ」の指示をやめ、困ったときの表を古い版の話にした。

## やらないこと

- Library の昇格のセル（`library-promote-routes.ts`）も plan mode で開くが、書き先が昇格先ごとに違い（CLAUDE.md、スキル、メモリ）、一つのフォルダを許すことでは直せない。別に扱う。
- 再開したセルに規則を持ち越すこと（記録を増やすほどの場面ではない）。
