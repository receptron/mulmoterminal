---
title: サーバを別のマシンで動かす（SSH・Docker）
layout: default
parent: 日本語
nav_order: 22
description: MulmoTerminal を Linux のマシンや VPS、Docker で動かし、手元のブラウザから SSH トンネルで使う。
---

# サーバを別のマシンで動かす
{: .no_toc }

- TOC
{:toc}

MulmoTerminal は、1 つのサーバ（Express、ターミナル、tmux、各エージェントの CLI）と、そのサーバが配る
Web ページでできています。サーバは、ブラウザと同じマシンで動いている必要はありません。Linux のマシンや
VPS、コンテナに置き、手元のノート PC から **SSH トンネル**でつなげます。エージェントはそちらで動き、
ノート PC を閉じても動き続けます。

これは**最初の版**です。通しで動かしたのは 1 回（Linux のコンテナに `ssh -L` でつないだ）だけで、まだ
誰も試していない部分は下にそう書いてあります。使ってみたら、結果を
[issue #2669](https://github.com/receptron/mulmoterminal/issues/2669) に書いてください。次の版はそれで
決めます。

## ポートを開けずにトンネルを使う理由

サーバには**ログインがありません**。`127.0.0.1` でしか待ち受けないので、マシンの外からは届きません。
SSH トンネルなら、その状態のまま使えます。ノート PC の `localhost:34567` が、SSH を通ってサーバの
`127.0.0.1:34567` につながり、サーバからは自分自身からの接続に見えます。ファイアウォールに穴を開ける
必要も、サーバの設定を変える必要もありません。

## サーバ側

必要なものは手元に入れるときと同じです（[はじめに](getting-started.html)）。Node.js 24.15 以上、`git`、
`gh`、使うエージェントの CLI（`claude`・`codex` など）。`tmux` は任意ですが、あると、サーバの再起動や
ノート PC の切断があってもターミナルが残ります。

SSH でログインして起動します:

```bash
ssh you@server
npx mulmoterminal@latest
```

SSH 経由で起動すると、サーバ側ではブラウザを開かず、手元で実行するトンネルのコマンドを表示します:

```text
[mulmoterminal] Started over SSH, so no browser is opened here. On your own machine, run:
[mulmoterminal]   ssh -N -L 34567:127.0.0.1:34567 you@<this-host>
[mulmoterminal] then open http://localhost:34567 there.
```

ログアウトしても動かし続けるには、`tmux`（または `screen` やサービス管理）の中で起動します。止めるときは
`npx mulmoterminal stop` です。

## ノート PC 側

```bash
ssh -N -L 34567:127.0.0.1:34567 you@server
```

ブラウザで **http://localhost:34567** を開きます。トンネルは切ってつなぎ直してかまいません。ターミナルは
サーバで動き続け、ページはそこに戻ります。

- ノート PC の `34567` が使われているとき（手元でも MulmoTerminal を動かしているなど）は、別のポートを
  転送します: `ssh -N -L 34599:127.0.0.1:34567 you@server`、開くのは `http://localhost:34599`。
- **`-A`** を付けると（`ssh -A -N -L …`）、エージェントがノート PC の鍵で `git push` でき、鍵をサーバに
  置かずに済みます。**信頼できるサーバでだけ**使ってください。つないでいる間は、そのサーバの root（とその
  サーバ上のあなたのアカウント）が、ノート PC の鍵を使って、その鍵が通るところへ認証できてしまいます。
  共有のマシンや信頼できないマシンでは、代わりにサーバ専用のデプロイキーを用意してください。

## サーバでエージェントにログインする

エージェントはサーバで動くので、ログインもサーバで要ります。どれもサーバにブラウザは要りません。

| 何 | やり方 |
|---|---|
| **Claude Code** | Shell のセルか SSH で、`claude` を 1 回起動します。サーバにブラウザが無いと、サインイン用の URL を表示し（"Browser didn't open? Use the url below to sign in"）、コードの入力を待ちます。その URL をノート PC で開いてサインインし、表示されたコードを貼ります。Linux ではログイン情報が `~/.claude` の下のファイルに残るので、次からは要りません。 |
| **GitHub（`gh`）** | `gh auth login` でブラウザを選び、表示された 1 回限りのコードを、ノート PC で `github.com/login/device` に入れます。MulmoTerminal 自身の PR・Issue の画面もこのログインを使います。 |
| **`git push`** | ノート PC から `ssh -A`（上記。信頼できるサーバでだけ）か、サーバに鍵や認証ヘルパーを用意します。 |
| **Codex** | `codex` を 1 回起動し、**Sign in with Device Code** を選びます。ノート PC で `https://auth.openai.com/codex/device` を開いてサインインし、表示された 1 回限りのコード（15 分で切れます）を入れます。 |

試した範囲で確認できたのは、画面の無い Linux で Claude Code のサインイン用 URL と、Codex のデバイスコードが
表示されるところまでです（どちらもサインインは最後までしていません）。

## Docker で動かす

公式のイメージはまだありません。次の `Dockerfile` は例です。このガイドのために実際にビルドして動かしました
（Node 24・`git`・`gh`・`tmux`・Claude Code 入り。ほかに使うエージェントは足してください）:

```dockerfile
FROM node:22-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tmux curl ca-certificates \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g mulmoterminal @anthropic-ai/claude-code
RUN useradd -m dev && mkdir -p /home/dev/work && chown -R dev:dev /home/dev
USER dev
WORKDIR /home/dev/work
# Published on the host's 127.0.0.1 only (see `docker run` below); the bind has to be wide inside.
ENV MULMOTERMINAL_HOST=0.0.0.0
EXPOSE 34567
CMD ["mulmoterminal", "--no-open"]
```

ビルドして、自分のマシンの `127.0.0.1` にだけ公開して起動します:

```bash
docker build -t mulmoterminal-server .
docker run -p 127.0.0.1:34567:34567 -v "$HOME/work:/home/dev/work" mulmoterminal-server
```

- `MULMOTERMINAL_HOST=0.0.0.0`（上の `Dockerfile` で設定しています）は、公開したポートがコンテナの中のサーバに届くために必要です。
  `[security]` の警告が出ますが、想定どおりです。ポートは `127.0.0.1` にだけ公開しているので、届くのは
  自分のマシンからだけです。この設定の意味は[設定](config.html)を見てください。
- エージェントのログイン情報は、イメージに焼き込まず**ボリューム**で渡します。`~/.claude`・
  `~/.claude.json`・`~/.codex`・`~/.config/gh`・`~/.gitconfig`、MulmoTerminal 自身の状態は
  `~/.mulmoterminal` です。
- 別のマシンの Docker なら、両方を組み合わせます。そのマシンの `127.0.0.1` に公開し、そのマシンへ
  `ssh -L` でトンネルを張ります。

## 手元と違うところ

グリッドの機能はすべて使えます。ターミナル、tmux での再接続、worktree、PR・Issue の画面、クリップボード、
通知音、スクリーンショットの貼り付け、Chrome でのファイルのドロップ（ファイルはサーバへアップロードされ
ます）。ただし、いくつかの操作は、あなたのマシンではなく**サーバのマシン**で動きます:

| 操作 | 画面の無い Linux のサーバ | リモートの Mac |
|---|---|---|
| ファイルマネージャで開く・OS のアプリで開く | エラーになります | **リモートの画面**で開きます |
| ファイルを選ぶダイアログ（「ファイルのパスを挿入」） | インストールの案内が出て失敗します | **リモートの画面**に出ます |
| 音声入力 | 出ません（Mac 専用の文字起こしを使うため） | サーバで文字起こしします |
| Safari・Firefox でのファイルのドロップ | **ノート PC のパス**が入ります（サーバには無いパスです） | 同左 |
| worktree の `env` チップの `localhost:<port>` のリンク | ノート PC で開きます。そのポートも転送してください | 同左 |
| Google カレンダーの連携 | サインインの戻り先が、サーバではなくノート PC になります | 同左 |

## 実験機能: サーバが別のマシンだと宣言する

ブラウザが別のマシンにあることは、サーバからは分かりません。トンネル越しの接続は、サーバ自身からの接続に
見えるためです。そこで宣言します。**設定 → Sessions and background tasks → 実験機能: サーバは別のマシンで
動いている**にチェックを入れるか、**サーバの** `~/.mulmoterminal/config.json` に書きます:

```json
{ "remoteServer": true }
```

宣言すると、上の表のうちサーバの画面で動いてしまう操作を止めます。パスメニューの「ファイルのパスを挿入」
「ファイルマネージャで開く」と、起動フォームのフォルダのボタンは出なくなります。同じ操作をヘッダーボタン・
キー・Files ペインから呼ぶと、代わりに理由が出ます。ドロップしたファイルは、ノート PC のパスを入れずに、
常にアップロードします。SSH を使わずに起動した場合（サービスとして動かすなど）も、サーバ側でブラウザを開き
ません。設定画面の Google のサインインは、代わりにサーバで `npx mulmoterminal google login` を実行するよう
案内します。設定画面のチェックはすぐに効きます。ファイルを手で書き換えたときは、サーバを再起動してください。実験機能なので、使ってみたら
[issue #2669](https://github.com/receptron/mulmoterminal/issues/2669) に結果を書いてください。

## リモートのサーバを相手に MulmoTerminal を開発する

サーバとページは別々にも起動できます。サーバで `yarn dev:server`（Express だけ）、ノート PC で
`yarn dev:client`（Vite だけ）を起動し、`34567` のトンネルを張っておきます。Vite は `/api` と `/ws` を
`localhost:34567` に転送し、トンネルがそれをサーバへ運びます。サーバが別のポートで待ち受けているときは、
クライアントにも同じポートを渡します: `PORT=<ポート> yarn dev:client`。
