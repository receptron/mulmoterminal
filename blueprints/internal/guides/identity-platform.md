# ログインを Identity Platform に切り替える

「会社のアドレスの人だけログインできる」ようにする仕組み（ログイン前の検査）は、Identity Platform に切り替えたプロジェクトでしか動きません。利用者が少なければ無料です。

1. 次のページを開きます: https://console.firebase.google.com/project/{{PROJECT_ID}}/authentication/settings
2. 「Identity Platform にアップグレード」（Upgrade to Identity Platform）のボタンを押します。
3. 確認の画面が出たら「アップグレード」（Upgrade）を押します。

**うまくいったかの見分け方**: 同じ設定ページの左の一覧に「ブロッキング関数」（Blocking functions）が現れます。

プロジェクトが2つあるときは、もう一方でも同じことをします。終わったら「済み」と返信してください。
