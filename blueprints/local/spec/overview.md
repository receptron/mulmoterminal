# {{appName}} — ローカル構成（Express + SQLite + Vue）

> 設計図パック `local` の雛形から作った。`{{…}}` はヒアリングの答えで埋める。埋まらないものは `.blueprint/open-questions.md` へ。

## 動く場所

このパソコンの中だけ。クラウドのアカウントも課金も使わない。`yarn start` で起動し、ブラウザで `http://localhost:{{port}}` を開く。

| 部品 | 役割 |
|---|---|
| Express（TypeScript） | API。`/api/*` |
| SQLite（Node 組み込みの `node:sqlite`） | データ。一つのファイル `data/app.db` |
| Vue 3 + Vite | 画面。ビルドしたものを Express が配る |

## データ

{{tables}}

表ごとに「列・型・必須か・一意か」と、表どうしのつながりを書く。

## API

{{endpoints}}

操作ごとに「メソッドとパス・入力・返すもの・だれが呼べるか」を書く。

## 画面

{{screens}}

## 決めていないこと

`.blueprint/open-questions.md` を参照。
