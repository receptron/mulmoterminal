# App Check の適用を有効にする

アプリ以外からデータベースや関数を呼ばれないようにする仕組みです。有効にすると、このアプリ以外からの呼び出しは断られます。

1. 次のページを開きます: https://console.firebase.google.com/project/{{PROJECT_ID}}/appcheck/products
2. 「API」（APIs）の一覧で「Cloud Firestore」の行を開き、「適用」（Enforce）を押して確定します。
3. 「Cloud Functions」の行でも同じく「適用」を押します。

**うまくいったかの見分け方**: 両方の行が「適用済み」（Enforced）になります。

**注意**: 適用の前にアプリの公開が済んでいないと、アプリ自身も断られます。順番はこちらで確認済みです。

終わったら「済み」と返信してください。
