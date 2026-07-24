# feat: ターミナルヘッダーの既定ボタンを充実（+ docs で上書き仕様を明記）

## User Prompt

> header２段目のメニューを充実させたい。私の設定のって標準では行ってないよね？ ~/.mulmoterminal/config.json のボタン
> で、ボタン、ユーザが追加するときどうしようね
> ちがう、既定値は私の設定と同様に多数表示される。でもユーザがせっていしたら上書きで、すくなくもできる。
> documentでそれもしっかり説明しよう。

## 背景

ターミナルヘッダー（2段目）の操作ボタンは config `buttons` で設定でき、未設定時は組み込みの
`DEFAULT_BUTTONS` が使われる。従来の既定は **📎 pick-file / 📂 reveal の2つだけ**で、便利な
🖥/🔗 等はユーザが各自 config に足す必要があった（新規インストールには出ない）。

`buttons` を設定すると既定は**丸ごと置き換え**（マージではない）。よって既定を多めにしても、
減らしたいユーザは自分の短いリストで上書きすればよい。

## 変更

- `server/config/header-config.ts` の `DEFAULT_BUTTONS` を **5つの充実セット**に:
  1. 📎 pick-file（ファイルパス挿入） 2. 📂 reveal（OSファイルマネージャ）
  3. 📁 files（アプリ内ファイル一覧, `open:{files:"${dir}"}`）
  4. 🖥 terminal（新規ターミナル, `open:{terminal:"${dir}"}`）
  5. 🔗 pr（`when:isGitRepo`, `open:{pr:true}` — PR 無しは自動ドロップ）
- `pr` は `when:isGitRepo` で git リポ限定、PR 無しで resolver がドロップ（既存の isVisible）。
- 「🌐 GitHub トップを開く」は当初含めたが、リポトップは `pr`（ブランチ PR）と役割が重複し不要との判断で外した。
- **docs / README** に、既定セットの内容と「`buttons` 設定＝丸ごと上書き（＝短いリストで減らせる）」を明記
  （README / docs/guide/{ja,en}/config.md）。

## テスト

- header-config.spec / header-resolve.spec の「既定=2つ」前提を新しい5つ・resolver 挙動（非git/PR有無）に更新。
- ミューテーション確認: 既定を元の2つに戻すとテストが赤 → 5つで green。
- server/config テスト 49件・typecheck・build・lint(0 error) パス。
