# ログイン前の検査（ブロッキング関数）を登録する

会社のアドレス以外のログインを断る検査を、プロジェクトに登録します。公開のときに自動で登録されることが多く、そのときはこの作業は要りません。

1. 次のページを開きます: https://console.firebase.google.com/project/{{PROJECT_ID}}/authentication/settings
2. 左の一覧から「ブロッキング関数」（Blocking functions）を選びます。見当たらないときは、先に Identity Platform への切り替えが必要です。
3. 「アカウントの作成前」（Before account creation）で `beforeUserCreated` を選びます。
4. 「ログイン前」（Before sign in）で `beforeUserSignedIn` を選びます。
5. 「保存」（Save）を押します。

**うまくいったかの見分け方**: 2つの欄にそれぞれの関数名が表示されたままになります。

終わったら「済み」と返信してください。
