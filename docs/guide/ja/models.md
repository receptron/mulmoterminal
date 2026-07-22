---
title: モデルとバックエンド
layout: default
parent: 日本語
nav_order: 6
---

# モデルとバックエンド
{: .no_toc }

- TOC
{:toc}

セッションを**どのモデルで動かすか**と、そのために**何の許可・鍵が要るか**をまとめたページです。
設定の書き方そのものは [設定方法](config.html#providers) にあります。ここは「実際に何が起きるか」側です。

何も設定しなければ、Anthropic のまま Claude Code 自身の既定モデルで動きます。

---

## 決まり方と優先順位

| 決めるもの | 書く場所 | 効く範囲 |
|---|---|---|
| **ディレクトリの既定** | `<project>/.mulmoterminal.json` の `provider` / `model` | そのディレクトリで開くセッション全部 |
| **起動時の選択** | 空セルの起動フォームの **MODEL** 欄 | **その 1 セッションだけ**（ファイルは書き換わりません） |
| 何も指定しない | — | Anthropic + Claude Code の既定モデル |

- **新規セッション** … 起動時に選んだものがあればそれ、なければディレクトリの既定。
- **再開（resume）** … 起動時の選択は**無視**され、**そのセッションが開始したときのバックエンド**を引き継ぎます。
  サーバを再起動すると開始時の記録（プロセス内のみ）が消えるため、その後の再開はディレクトリの既定に戻ります。

> **なぜ再開時は無視するのか**
> ブラウザは再接続のたびにセルが保持している選択を送りますが、その値は**そのセルが起動したセッション**のもので、
> いま再開しようとしているセッションのものとは限りません。会話の途中でバックエンドが入れ替わる方が危険なので、
> 開始時のものを優先します。

`provider` と `model` は常に**ペアで**扱われます。片方を別の場所から持ってきて混ぜることはしません
（provider だけ落ちて model が残ると、他社のモデル id を Anthropic に投げることになるため）。

---

## Anthropic のまま使う（既定）

### 認証

MulmoTerminal は Anthropic 用の鍵を自分では持たず、**`claude` コマンド自身の認証をそのまま使います**。
ターミナルで `claude` が動く状態なら、追加の設定は要りません。

Claude Code 側の認証の優先順位は次のとおりです（上ほど強い）。

1. `ANTHROPIC_API_KEY`
2. `ANTHROPIC_AUTH_TOKEN`
3. サブスクリプションの OAuth 資格情報（macOS では Keychain の `Claude Code-credentials`）

**`ANTHROPIC_API_KEY` が環境に残っていると、下の 2 つを黙って上回ります。** 「ログインしているはずなのに
API 課金される」「プロバイダに向けたはずが本家に行く」はたいていこれが原因です。プロバイダを使うセッションでは
MulmoTerminal が明示的に取り除きます（後述）。

### 別の Anthropic モデルを使う

`.mulmoterminal.json` に `model` **だけ**書きます（`provider` は書きません）。

```json
{ "model": "sonnet" }
```

値は `claude --model` にそのまま渡るので、`sonnet` / `opus` / `haiku` のエイリアスでも、正式なモデル id でも構いません。

> **起動フォームの MODEL 欄に Anthropic のモデルは並びません。**
> 選択肢に出るのは `config.json` の `providers` に登録したバックエンドのモデルだけで、プロバイダを 1 つも
> 登録していなければ**選択欄そのものが出ません**（代わりに設定方法へのリンクが出ます）。
> Anthropic 側のモデルを変える手段は、いまのところ `.mulmoterminal.json` の `model` だけです。

---

## 別のバックエンドで動かす（プロバイダ）

登録手順は [設定方法 → 別のモデルで動かす](config.html#providers) を見てください。ここでは、
そのセッションが**実際にどう起動されるか**を書きます。

### セッションに渡るもの

プロバイダを使うセッションには、Claude Code の設定ファイル（`--settings`）の `env` ブロック経由で次が渡ります。

| 変数 | 値 | なぜ必要か |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `baseUrl` | 接続先 |
| `ANTHROPIC_AUTH_TOKEN` | `tokenEnv` が指す環境変数の**値** | 認証 |
| `ANTHROPIC_MODEL` | 選んだモデル id | |
| `ANTHROPIC_SMALL_FAST_MODEL` | 同じモデル id | Claude Code はタイトル生成などで裏に haiku を呼びます。haiku を持たないバックエンドではそれが 400 になるため、同じモデルに向けます |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `maxOutputTokens`（省略時 **16000**） | 思考型モデルは出力枠が足りないと考えるだけで終わり、**返答が空**になります |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | 転送したセッションが裏で本家 Anthropic を叩き続けないように |
| `ANTHROPIC_API_KEY` | **環境から削除** | 残っていると認証トークンを黙って上回り、意図しない接続先になります |

環境変数を直接渡すのではなく設定ファイルの `env` ブロックを使うのは、**Claude Code 自身がそれを適用する**ため、
ホスト・tmux のペイン・コンテナのどれでも同じように効くからです。

トークンを含む設定は `ps` から他ユーザーに見えないよう、`~/.mulmoterminal/settings/<session-id>.json`
（パーミッション `0600`）に書き出され、コマンドラインにはそのパスだけが載ります。ファイルはセッション終了時に消えます。

### 鍵が無ければ起動しません

`tokenEnv` が指す環境変数が空／未設定なら、そのセッションは**起動を拒否します**。

```
provider 'openrouter' needs OPENROUTER_API_KEY in the server's environment — refusing to start
```

黙って Anthropic に落とさないのは、**base URL だけがあってトークンが無い状態は、あなたのサブスクリプション
資格情報をその第三者に送ってしまう**からです（Claude Code の認証は base URL の変更だけでは止まりません）。
落とす代わりに止めます。

### tmux を使っている場合

tmux のペインは、起動したクライアントではなく **tmux サーバの環境**を継承します。そのため MulmoTerminal は
プロバイダのセッションを起動する前に、tmux サーバのグローバル環境から `ANTHROPIC_API_KEY` を取り除きます。
先に起動した非プロバイダのセッションが tmux サーバに鍵を持ち込み、後続のプロバイダのペインがそれを継承して
しまうのを防ぐためです。

---

## 必要な許可・認証情報

| やりたいこと | 必要なもの | どこに置くか |
|---|---|---|
| **Anthropic のまま使う** | `claude` が認証済みであること | Claude Code 自身が管理（MulmoTerminal は触りません） |
| **プロバイダを使う** | そのサービスの API キー | **サーバを起動するシェルの環境変数**、または隣に置いた `.env`。設定ファイルには入れません |
| **OpenRouter を使う** | アカウントのデータポリシー設定で配信元を許可 | [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy) |
| **ツール実行の許可レベルを変える** | `CLAUDE_PERMISSION_MODE` | サーバ起動時の環境変数 |
| **Docker サンドボックスで動かす** | macOS + 起動中の Docker | `MULMOTERMINAL_SANDBOX=1`。**プロバイダとは併用できません** |

鍵は必ず**名前**で参照します。`config.json` に書くのは `tokenEnv`（環境変数の名前）であって、値ではありません。
この設定はブラウザやスマホにも HTTP で配られるため、値を書ける場所を用意していません。

環境変数を足したら**サーバの再起動**が必要です。

### ツール実行の許可（`CLAUDE_PERMISSION_MODE`）

MulmoTerminal が起動する Claude セッションは `--permission-mode` 付きで起動します。既定は **`auto`**
（バックエンドが手離しで進める状態）。変えたいときはサーバ側の環境変数で指定します。

```bash
CLAUDE_PERMISSION_MODE=default npx mulmoterminal@latest
```

`default` / `acceptEdits` / `bypassPermissions` / `plan` などが渡せます。

### macOS の Keychain（サンドボックス使用時のみ）

`MULMOTERMINAL_SANDBOX=1` でコンテナ実行するときだけ、MulmoTerminal は Keychain の
`Claude Code-credentials` を読み、コンテナに現在の資格情報を渡します（コンテナは Keychain を読めず、
`~/.claude/.credentials.json` は無い／古いことが多いため）。macOS がアクセスの許可を求めることがあります。
トークンが期限切れなら、先にホストの `claude` を動かして更新してから渡します。

ホストでそのまま動かす通常のセッションでは、この経路は使いません。

---

## 起動時に選ぶ

プロバイダが 1 つでも使える状態なら、空セルの起動フォームに **MODEL** の選択欄が出ます。

```
Kimi K2.7 Code · 3/3 · 14s · 262k
```

脇の数字は実測値です（`3/3` = ツールを使う課題を完走した回数 / 試行回数、`14s` = 中央値、`262k` = コンテキスト長）。
読み方と計測方法は [設定方法 → 起動時に選ぶ](config.html#providers) にあります。

鍵が無いなど**使えない状態のプロバイダは選択肢に出ません**。代わりにヘルプ側に、そのセッションが拒否されるときと
**同じ一文**が出ます。直すべき 1 か所がそのまま書いてあるので、それを直してサーバを再起動してください。

---

## うまくいかないとき

| 症状 | 原因 | 対処 |
|---|---|---|
| `... needs XXX_API_KEY in the server's environment` | 鍵がサーバの環境に無い | シェルか `.env` に入れてサーバを再起動 |
| `unknown provider 'xxx'` | `.mulmoterminal.json` の `provider` が `config.json` の `providers` に無い | id の綴りを合わせる |
| `provider 'xxx' needs a model` | provider だけ指定して model が無い | `.mulmoterminal.json` に `model` も書く |
| `has an unusable baseUrl` | `http(s)://` でない、または末尾が `/v1` | `/v1` を外す（Claude Code が `/v1/messages` を自分で足します） |
| 404 が返る | 上と同じ（`/v1/v1/messages` になっている） | `baseUrl` から `/v1` を外す |
| **返答が空**のまま終わる | 思考型モデルで出力枠が足りない | `maxOutputTokens` を上げる（既定 16000） |
| 選んだはずのモデルで動かない（再開時） | 再開は**開始時**のバックエンドを引き継ぐ仕様 | 新しいセッションとして起動し直す |
| サーバ再起動後、再開セッションが既定に戻る | 開始時の記録はプロセス内のみ | 仕様。ディレクトリ既定を `.mulmoterminal.json` に書いておく |
| `cannot run in the Docker sandbox yet` | プロバイダとサンドボックスの併用 | どちらかを外す |
| ピッカーに `not reachable from this account` と出る | 計測に使った OpenRouter アカウントのプライバシー設定で配信元が全部除外されていた | **モデルの欠陥ではありません**。自分のアカウント設定次第では動きます |

モデル一覧は `common/modelPresets.ts`、計測スクリプトは `scripts/model-trials.ts` です。
