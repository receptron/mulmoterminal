# {{appName}} — Firebase の構成

> この文書は設計図パック `firebase` の雛形から作られた。`{{…}}` はヒアリングの答えで埋める。
> 埋まらなかった項目は `.blueprint/open-questions.md` に移す。

## 使うもの

| 部品 | 用途 |
|---|---|
| Firebase Hosting | 画面の配信 |
| Firebase Authentication | ログイン |
| Cloud Firestore | データ（リージョン: `{{region}}` — 作成後は変更できない） |
| Cloud Functions | 権限の付与、ログイン時の検査、監査ログなど、利用者に任せられない処理 |
| App Check | 正規のアプリ以外からの呼び出しを弾く |

## プロジェクト

| 用途 | プロジェクト ID | 備考 |
|---|---|---|
| 開発 | `{{devProjectId}}` | 試験・確認用。本番のデータは置かない |
| 本番 | `{{prodProjectId}}` | 公開は必ず人の承認を経る |

どちらも Blaze（従量課金）プランが必要（Cloud Functions のため）。予算アラートは月 `{{budget}}` 円で設定する。

## データ

{{collections}}

コレクションごとに「誰が読めるか・誰が作れるか・誰が変えられるか・誰が消せるか」を表で書く。
表に無い操作はすべて拒否する。

## 決めていないこと

`.blueprint/open-questions.md` を参照。
