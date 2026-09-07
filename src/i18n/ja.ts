import type { Messages } from "./messages";

// 日本語。`Messages` は en.ts の形そのものなので、キーを一つ落とすと型エラーになる — 実行時に
// 英語へフォールバックして気づかない、という状態にはならない。
//
// セクション名（tabs.*）は英語のままのものがある。config.json のキー名や skill の名前と一対一で
// 対応していて、ガイドや README もその語で書かれているため、訳すと探し先が分かれる。
export const ja: Messages = {
  settings: {
    title: "設定",
    close: "閉じる",
    closeAria: "設定を閉じる",
    sectionsNav: "設定のセクション",
    sectionPicker: "設定のセクション",

    groups: {
      appearance: "表示",
      projects: "プロジェクト",
      launch: "ヘッダーと起動",
      input: "入力",
      models: "モデルとサーバ",
      notifications: "通知",
      integrations: "連携",
      sessions: "セッション",
      help: "ヘルプ",
    },

    tabs: {
      language: "言語",
      theme: "配色（テーマ）",
      font: "ターミナルのフォント",
      fontSize: "ターミナルの文字サイズ",
      scroll: "ターミナルのスクロール量",
      waitingRows: "待機中の行",
      gridHeader: "グリッドのヘッダー表示",
      toolbarPins: "ツールバーのピン",
      dirAppearance: "ディレクトリの見た目",
      dirSettings: "ディレクトリ設定",
      launchers: "起動コマンド",
      headerChrome: "ヘッダーのボタンとチップ",
      terminalKeys: "ターミナルのキー",
      shortcuts: "キーボードショートカット",
      voice: "音声入力",
      models: "モデルとバックエンド",
      mcp: "MCP サーバ",
      sounds: "通知音",
      push: "Web Push 通知",
      quickCommands: "スマホの定型文",
      github: "GitHub と GitLab",
      prRepos: "プルリクエストのリポジトリ",
      google: "Google アカウント",
      sessions: "セッションとバックグラウンド処理",
      surviving: "再起動を生き延びたセッション",
      cost: "コスト（推定）",
      quit: "MulmoTerminal を終了",
      help: "ヘルプとユーザーガイド",
    },

    terminalKeys: {
      copyOnSelect: "選択が確定したらすぐコピーする",
      copyOnSelectTitle: "選ぶだけでコピー",
      copyOnSelectHint:
        "マウスの選択が確定した瞬間、キーを押さなくてもクリップボードに入ります。ハイライトしただけのつもりでもクリップボードが書き換わる、唯一の設定です。",
      questionPane: "質問にサイドペインから答える",
      questionPaneTitle: "質問ペイン",
      questionPaneHint:
        "セッションが質問してきたとき、選択肢をターミナル横のペインにボタンで出します。押すと、ターミナルに出ている実際のダイアログのキーを代わりに押すので、これまでどおりターミナル側で答えることもできます。",
      enterTitle: "Enter キー",
      enterHint:
        "ターミナル内の Claude Code が「送信」として読むバイト列です。お使いの Claude の設定に合わせてください。Claude セッションにだけ適用され、シェルの Enter は変わりません。",
      enterField: "Claude セッションで送信になるバイト列",
      modes: {
        cr: "Enter で送信、Option/Alt+Enter で改行（既定）",
        "esc-cr": "Option/Alt+Enter で送信、Enter で改行",
      },
    },

    shortcuts: {
      intro:
        "読み取り専用で、割り当ての有無にかかわらず全部 {keymapKey} の下に並びます。割り当てられるのは 2 種類 —— MulmoTerminal の操作（拡大、待っているエージェントへ移動、コピー / ペースト）と、ターミナルへのキー列送信（macOS で Cmd+← を行頭へ、など）。割り当てたキーはターミナル内のプログラムに届かなくなるので、下のボタンから設定してください —— エージェントが、既にある割り当てや、ブラウザ / Mac 固有の落とし穴と突き合わせてから書き込みます。{guide}にリファレンスがあります。",
      guide: "ガイド",
      actions: {
        zoomToggle: "ターミナルを拡大 / 元に戻す",
        zoomNext: "次のターミナルを拡大",
        zoomPrev: "前のターミナルを拡大",
        nextAttention: "あなたを待っているターミナルへ移動",
        terminalNew: "起動パネルを開く",
        terminalNewHere: "このターミナルのディレクトリで起動パネルを開く",
        terminalNewAdjacent: "このターミナルのディレクトリで、そのままシェルを開く",
        terminalClose: "このターミナルを閉じる",
        terminalRestart: "このターミナルのエージェントを再起動する",
        copy: "ターミナルの選択範囲をコピー",
        paste: "ターミナルにペースト",
      },
      list: "キーボードショートカット",
      notSet: "未設定",
      sendRow: "{key} をターミナルに送る",
      sendNone: "ターミナルにキー列を送る",
      setUp: "ショートカットを設定する…",
    },

    surviving: {
      intro:
        "ターミナルはサーバより長生きするので、ここに出るのは以前の起動から動き続けているものです。{whatever}一覧に出ます — もう開かないディレクトリのものも、ここ以外のどの一覧にも出ないシェルも含みます。行を止めてもそのセッションが終わるだけで、トランスクリプトのある会話は後からそのディレクトリで再開できます。",
      whatever: "どのディレクトリのものでも",
      shellOrUnknown: "シェルまたは不明",
      unknownAgentTitle: "このキーに対応するエージェントの会話が記録されていません — シェル、ランチャのコマンド、あるいはこのサーバが辿れないエージェントです",
      lastActive: "最終アクティビティ {when}",
      loading: "生き延びたセッションを読み込み中…",
      failed: "読み込めませんでした — tmux が動いていない可能性があります。",
      unknownDir: "ディレクトリ不明",
      unknownDirTitle: "このサーバはどこで動いているかを一度も見ていません",
      notResumable: "再開不可",
      notResumableTitle: "これを再開できるものがディスク上にありません",
      doomed: "次回起動時に終了",
      doomedTitle: "誰も使っておらず {days} 日間出力もありません — 次のサーバ起動時に終了されます",
      open: "● 使用中",
      openTitle: "ターミナルが掴んでいます — そちらで閉じてください",
      stopTitle: "このセッションを止める",
      stopAria: "{dir} のセッションを止める",
      stopAriaUnknown: "不明なディレクトリ",
      none: "なし — 以前のサーバから動いているものはありません。",
      reapStepper: "セッションを終了するまでのアイドル日数",
      reapUnit: " 日",
      neverTitle: "自動では終了しません。",
      neverHint: "ここで止めるか、掴んでいるターミナルから終わらせるまで残ります。",
      reapHint: "誰も使っておらず、この日数だけ出力の無いセッションは{ended}。会話は残ります。0 にすると自動終了しません。",
      reapEnded: "次のサーバ起動時に終了されます",
    },

    sounds: {
      intro:
        "どの瞬間に鳴らすか、そしてそれぞれ何を鳴らすか。エージェントを何本も同時に動かすと通知はただの雑音になるので、要らないものはチェックを外してください。ツールバーのスピーカーボタンで一括して黙らせられます。",
      beepAria: "セッションが {kind} のときに鳴らす",
      soundFor: "{label} の音",
      playFor: "{label} の音を再生",
      default: "既定",
      defaultTitle: "既定",
      defaultHint:
        "は下で指定したファイルを鳴らします。空ならば組み込みのチャイムです。プリセットは一度取得したらこのマシンに保存されるので、オフラインでも鳴ります。",
      fileField: "通知音のファイル",
      browse: "参照…",
      useChime: "チャイムに戻す",
      useChimeTitle: "組み込みのチャイムを使う",
      outro:
        "ここで設定するのは全セッション共通の音です。スキルを使うと、プロジェクトごとの音、スマホにプッシュする瞬間、そのうちどれがあなたを起こすのか、まで決められます。",
      configure: "通知を設定する…",
      kinds: {
        finished: "ターンが終わった",
        waiting: "あなたを待っている",
        "command-done": "コマンドが終わった",
        "command-failed": "コマンドが失敗した",
        "session-exited": "セッションが終了した",
        "worker-failed": "バックグラウンドの処理が失敗した",
        "pr-ci-failed": "PR の CI が落ちた",
      },
      help: {
        finished: "エージェントが返信し、その出力がまだ読まれていない",
        waiting: "権限の確認や質問で止まった",
        "command-done": "Run セルのコマンドが正常終了した",
        "command-failed": "Run セルのコマンドがエラー終了した、または起動しなかった",
        "session-exited": "セッションのターミナルが終わった（自分でセルを閉じた場合も含む）",
        "worker-failed": "バックグラウンドの処理が終わらないまま落ちた — 画面にターミナルが無いので、これ以外に知らせるものがありません",
        "pr-ci-failed": "ディレクトリの PR が赤くなった。ポーリングしているのがロスターなので、ロスターが画面にあるときだけ分かります",
      },
    },

    guide: {
      prompt: "MulmoTerminal の使い方が分からないときはガイドをどうぞ —",
    },

    push: {
      intro:
        "バックグラウンドの処理が終わったとき、登録済みのデバイスにプッシュを送ります。{remoteHost} 接続が必要です — そのサインインが通知の認証を兼ねているため、接続中しか送られません。",
      remoteHost: "RemoteHost",
      master: "デバイスに Web Push を送る",
      masterLabel: "デバイスに通知する",
      whichMoments: "プッシュする価値のある瞬間:",
      kindAria: "セッションが {kind} のときにプッシュ",
      kinds: {
        finished: "ターンが終わった",
        waiting: "あなたを待っている",
      },
      help: {
        finished: "エージェントが返信し、その出力がまだ読まれていない",
        waiting: "権限の確認や質問で止まった。プロンプトごとに 1 回鳴るので、よく聞いてくるタスクはよくプッシュします",
      },
    },

    github: {
      issueComments: "セルが着手した issue にコメントする",
      issueCommentsTitle: "issue に着手したことを書く",
      issueCommentsHint:
        "コメントは 1 つだけで、着手時に投稿し、PR が開いたとき・マージされたときに編集します。作業ディレクトリ名（パスではなくフォルダ名）を書くので、2 つのターミナルが同じ issue に二重着手しません。{gh}（または {glab}）のログインが必要です。",
      prFooter: "作成した PR の末尾にクローン名を書く",
      prFooterHint: "本文の最後に {line} の 1 行を足します。横に並んだ複数のクローンのどれで作業したかが PR から分かります。",
      gitlabTitle: "セルフホストの GitLab",
      gitlabHint:
        "URL を見てもそのホストがどの forge かは分からないので、ここで宣言すると {glab} でリポジトリを読みます。{authCommand} が必要です。次のサーバ起動から有効になります。",
      gitlabField: "セルフホストの GitLab ホストを追加",
    },

    sessions: {
      summary: "返信をまとめで終わらせる",
      summaryHint:
        "何を頼まれ、何ができて、何ができなかったか、を規則として書かせます。グリッドのための機能です — 後からセルに戻ったとき、これが無いとセッション全体をスクロールしないと分かりません。これ以降に開始したセッションに適用され、ディレクトリ自身の {dirFile} が優先されます。",
      digest: "決定事項のダイジェストを残す",
      digestTitle: "このプロジェクトで決めたことのダイジェストを残す",
      digestHint: "エージェントが「もう決まっていること」を聞き直す前に読める Markdown ファイルです。{dir} の下に書き出します。",
      worklog: "開発作業ログを定期的に残す",
      worklogHint:
        "保存した作業ディレクトリ全体の最近の作業を、週ごとの wiki ページにまとめます。実行のたびに LLM セッションを起動するのでトークンを消費します。",
      worklogInterval: "実行間隔:",
      worklogStepper: "開発作業ログの間隔",
    },

    launchers: {
      intro:
        "グリッドのセルで動かせる対話コマンドなら何でも — 開発サーバ、REPL、git の UI、モデルのブリッジなど。セルのディレクトリで、書いたとおりのコマンドが永続ターミナルとして動きます。例: {labelExample} → {commandExample}。",
      notAnAgent:
        "Claude / Codex / Antigravity を起動したいときは、空のセルの Agent Picker を使ってください。ランチャではセッションに必要なものが何も付きません。",
      labelField: "ランチャのラベル",
      labelPlaceholder: "ラベル",
      commandField: "ランチャのコマンド",
      commandPlaceholder: "コマンド（例: $SHELL）",
    },

    quickCommands: {
      intro:
        "よく送る言い回しを、スマホのターミナル表示にチップとして並べます。タップすると入力欄に入るだけで、送信ボタンを押すまで送られません。ラベルはチップの見た目なので短くしてください。例: {labelExample} → {textExample}。どれもチェックしなければ全種類に出ます。合うものだけチェックすることもできます — {gitStatus} はシェル用で、Claude 用ではありません。",
      labelField: "定型文のラベル",
      labelPlaceholder: "ラベル",
      textField: "定型文の本文",
      textPlaceholder: "入力欄に入れる文字列（例: PR作って）",
      offerTo: "出す相手:",
      offerToAgent: "{agent} のセッションに出す",
      offerToNone: "（未チェック = 全種類）",
    },

    mcp: {
      intro:
        "{singleView}の Claude セッションが読み込む HTTP MCP サーバです（組み込みの GUI ツールに加えて）。{idKey} がサーバ名、{urlKey} が streamable-HTTP のエンドポイント。Docker サンドボックスでは {localhost} の URL は自動的に {dockerHost} 経由になります。次の Claude セッションから有効になります。",
      singleView: "単一ビュー",
      idField: "MCP サーバの id",
      idPlaceholder: "id（例: weather）",
      urlField: "MCP サーバの URL",
      urlPlaceholder: "https://… または http://localhost:PORT/mcp",
    },

    headerChrome: {
      intro:
        "ターミナルのヘッダーに並ぶ操作ボタンと表示チップです。グローバルには{buttons}・{chips}があります。プロジェクト側は自分の {dirFile} で id 単位に追加・置換できるので、実際に出るのは両者をマージしたものです。",
      builtInButtons: "組み込みのボタン",
      noButtons: "ボタンなし（すべて削除済み）",
      someButtons: "ボタン {count} 個",
      builtInChips: "組み込みのチップ",
      noChips: "チップなし（すべて削除済み）",
      someChips: "チップ {count} 個",
      setUp: "ヘッダーのボタンを設定する…",
    },

    models: {
      intro:
        "セッションを動かせる Anthropic 互換のバックエンドです（{configFile} の {providersKey} から）。ディレクトリごとに {dirFile} の {providerKey} / {modelKey} で固定できます。API キーは環境変数に置き、設定ファイルには書きません。",
      modelCount: "モデル {count} 個",
      keyIn: "キーは {env}",
      notReady: "使用不可",
      notInPicker: "ピッカーに出ません",
      ready: "使用可",
      noProviders: "未設定 — セッションは組み込みの既定で動きます。",
      customTitle: "自分のやり方で Claude Code を起動する",
      customIntro:
        "— Claude / Codex / Antigravity / Shell と並んで Agent Picker に出ます。ランチャではありません: Claude Code 自身の引数がコマンドの後ろに付くので、他の Claude セッションと同じように再開・コスト表示・GUI ツールが効きます。",
      noCustomAgents: "未設定。",
      addBackend: "バックエンドを追加する…",
    },

    common: {
      add: "追加",
      remove: "{name} を削除",
    },

    dirAppearance: {
      intro:
        "{skill} スキルを起動すると、ディレクトリの見た目と並び — 名前バッジ、アイコン、色、ターミナルのパレット、グリッド上の位置 — を設定できます。実際に開いているディレクトリを起点に、既存の設定を読み、まだ何も無いものにも同じ流儀で付けます。",
      configure: "見た目を設定する…",
      favicon: "プロジェクト自身の favicon を使う",
      faviconHint:
        "{iconKey} を設定していないディレクトリは、そのリポジトリが既に持っている画像（{svg}、{png}、web manifest）を表示します。要らないプロジェクトは自分の {dirFile} に {iconFalse} と書きます。こちらの設定はそれを上書きしません。",
    },

    dirSettings: {
      intro:
        "各ディレクトリの {dirFile} が実際に何をしているか。行を開くと、効いている値と、アプリが捨てたキー・認識しないキーが見えます。効かなかった設定は、これを見るまでは「そもそも書いていない」のと見分けが付きません。",
      outro: "ここに出るのは「どこがおかしいか」です。スキルは同じものを読んで理由を説明し、直すか、そのキーを持つスキルへ案内します。",
      explain: "設定を説明してもらう…",
    },

    google: {
      intro:
        "Google アカウントを連携すると、{tool} ツールとスマホから{calendar}の予定を読み書きできます。サインインは新しいタブで開き、{thisMachine}で完了するので、ここのブラウザを使ってください。リモート接続越しなら代わりに {cli} を実行します。この連携は MulmoClaude と共有されます。",
      calendar: "カレンダー",
      thisMachine: "このマシン",
      checking: "確認中…",
      pending: "ブラウザでの許可を待っています…",
      linked: "連携済み",
      notLinked: "未連携",
      signIn: "Google でサインイン",
      unlink: "連携を解除",
      confirmUnlink: "この Google アカウントの連携を解除しますか？ もう一度サインインするまで、MulmoTerminal はカレンダーにアクセスできなくなります。",
      secretMissing:
        "~/.secrets に OAuth のクライアントシークレットが見つかりません。デスクトップ クライアントの client_secret_*.json をそこに置くとサインインできます。使えるなら GCP 設定不要のブローカー連携でも構いません。",
      secretAmbiguous: "~/.secrets に client_secret_*.json が複数あります。1 つだけ残してください。",
    },

    prRepos: {
      intro: "横断{view}ビューが open な PR を一覧するリポジトリです。{gh} のログインを使います。形式は {format}。",
      view: "プルリクエスト",
      field: "リポジトリを追加（owner/repo）",
    },

    skillLaunch: {
      hint: "設定はエージェントが代わりに書きます。いくつか質問したうえで、設定ファイルを書き換えます。",
    },

    skillConfirm: {
      title: "エージェントに設定してもらいますか？",
      what: "グリッドに新しいターミナルが 1 つ開き、そこで {agent} が動きます。いくつか質問したうえで、設定ファイルを書き換えます。",
      howToStop: "やめるときは、そのターミナルを閉じるボタンで閉じてください。そこでセッションは終わります。設定はツールバーからいつでも開き直せます。",
      launchWith: "起動するのは",
      launchWithAria: "この skill を動かすエージェント — コレクション発のチャットと同じ設定",
      cancel: "キャンセル",
      start: "開始",
    },

    version: {
      label: "バージョン",
      commit: "コミット {sha}",
    },

    voice: {
      intro:
        "音声入力で話す言語です。マイクが想定していない言語で話すと、想定された言語に{translated}返ってきます — ブラウザの言語のままにせず、実際に話す言語を選んでください。",
      translated: "翻訳されて",
      picker: "音声入力の言語",
      browserLanguage: "ブラウザの言語にあわせる",
      detect: "話した内容から判定する",
      always: "常にこの言語",
    },

    stepper: {
      decrease: "{label}を減らす",
      increase: "{label}を増やす",
    },

    theme: {
      missing: "選択中のテーマ {id} が定義されていません。{configFile} の {themesKey} に追加するか、下から選んでください。それまで選択は保持されます。",
      intro:
        "あるものから選びます。自作の配色は {configFile} の {themesKey} に置くと、組み込みの 4 つの隣に出ます。スキルはパレット・写真・ブランドカラーから配色を書き起こし、コントラストも確認します。",
      group: "テーマ",
      create: "テーマを作る…",
    },

    font: {
      intro:
        "すべてのターミナルが使う CSS の font-family スタックです。CJK の表示が崩れるとき（先頭のフォントに日本語グリフが無いと文字単位でフォールバックし、行が揃わなくなります）はここを直します。空欄なら組み込みのスタック。ディレクトリごとに {dirFile} の {key} で固定できます。",
      field: "ターミナルの font-family スタック",
      apply: "適用",
      invalid:
        "フォントスタックとして解釈できません。名前はカンマ区切りで — {example}。CSS の構文文字や閉じていない引用符は拒否します。1 つ壊れているだけで宣言全体が無効になるためです。",
      hint: "適用した瞬間に開いているターミナルが再フィットします — フォントが変われば文字送り幅も変わり、そのままではグリッドがキャンバスとずれるためです。総称ファミリを書かなかった場合は {mono} が末尾に足されるので、どれにも一致しないスタックでも等幅にフォールバックします。",
    },

    fontSize: {
      stepper: "ターミナルの文字サイズ",
      hint: "このブラウザのすべてのターミナルに適用されます。ディレクトリごとに {dirFile} の {key} で固定できます。",
    },

    scroll: {
      stepper: "ターミナルのスクロール量",
      hint: "ホイール 1 ノッチ、あるいはトラックパッドの 1 スワイプでターミナルがどれだけ動くか（1× が既定）。Mac のトラックパッドの 2 本指スクロールで読んでいた場所を通り過ぎてしまうなら下げてください。ブラウザごとの設定で、シェルのスクロールバックにも Claude Code のような全画面アプリにも効きます。",
      returnLabel: "送信したら最新の出力に戻る",
      returnHint:
        "Enter（や送信ボタン）を押すと、スクロールして上を見ていたターミナルが普通のターミナルと同じように一番下へ戻ります。シェルは元からこの挙動ですが、Claude Code のような全画面エージェントは自前でスクロール位置を持つため戻りません。この設定はそのスクロールをちょうど巻き戻します。ターンの実行中も読んでいる場所に留まりたいならオフにしてください。",
    },

    toolbarPins: {
      intro:
        "ピン留めしたコレクションやフィードを、ツールバーの Grid / Collections の隣に置けます。Collections を開いて上端の行から探す代わりに、一手で開けます。選べるのは {max} 件まで。1 件も選ばなければツールバーは今までのままです。",
      empty: "まだ何もピン留めされていません。先に Collections を開いてコレクションやフィードをピン留めしてください。ここに並ぶのはピン留めしたものです。",
      loadFailed:
        "ピン留めの一覧を読み込めませんでした（{error}）。そのためここに出せるものがありません。ツールバーは今まで出していたものをそのまま表示します。接続が戻ってから開き直してください。",
      full: "上限は {max} 件です。増やすにはどれかを外してください。数件を超えると、ツールバーが元から載せているものを押し出します。",
    },

    gridHeader: {
      intro: "グリッドの上のバーが一目で伝えること。Claude / Codex の使用量ウィンドウの隣に並びます。",
      loadAverage: "このマシンの load average を表示する",
      loadAverageTitle: "Load average",
      loadAverageHint:
        "セッションを動かしているマシンの負荷を、コア数に対する % で表示します。100% は全コアに実行待ちがある状態で、ここからエージェントを足すと今動いているものが遅くなります。100% で琥珀色、200% で赤。load average を持たないホスト（Windows）では、この設定にかかわらず何も出ません。",
    },

    waitingRows: {
      intro:
        "拡大したセルの横に出る一覧で、エージェントが{waiting}行 — 権限の確認や質問 — は琥珀色のリングが付いて点滅します。単に{finished}行は緑で静止します。オフにすると色はそのままで動きだけ止まります。OS が「視差効果を減らす」設定のときは元から点滅しません。",
      waiting: "あなたを待っている",
      finished: "終わっただけの",
      blink: "待っている行を点滅させる",
      linesTitle: "1 行あたりの行数",
      linesHint: "各行をどこまで表示してから打ち切るか。増やすほど 1 つを読みやすくなり、画面に収まるセッション数は減ります。",
      fields: {
        summary: "サマリ",
        prompt: "あなたの入力",
        response: "直近の返信",
      },
      steppers: {
        summary: "サマリの行数",
        prompt: "あなたの入力の行数",
        response: "直近の返信の行数",
      },
    },

    cost: {
      intro:
        "{pricing}（入力・出力・キャッシュのトークン）から算出した、このプロジェクトの推定額です。実際の請求とは異なることがあり、定額プラン（Max）の利用は反映されません。Today / Month はこのプロジェクトのセッションを合算します。",
      pricing: "公開されているモデル別価格",
      group: "推定コスト",
      groupTitle: "公開されているモデル別価格からの推定です。実際の請求とは異なることがあります。",
      session: "セッション",
      today: "今日",
      month: "今月",
      failed: "コストの推定を読み込めませんでした。",
      unpriced: "価格が分からないモデルを使ったターンがあり、この推定からは除外されています。",
    },

    quit: {
      description:
        "このマシンで動いている MulmoTerminal サーバを終了します。このタブを閉じてもサーバは止まりません。起動したターミナルに戻らずに止める手段がここです。",
      // Message-function form, which skips vue-i18n's message compiler: the literal `@` in
      // `mulmoterminal@latest` would otherwise be read as a linked-message reference, the compiler
      // throws, and the whole section renders as nothing.
      restartHint: () => "もう一度起動するには、ターミナルで `npx mulmoterminal@latest` を実行してください。",
      button: "MulmoTerminal を終了",
      confirmBody: "サーバが停止し、このページは動かなくなります。グリッド上のターミナルは画面から消えます。",
      sessionsNote:
        "Ctrl+C と同じです。tmux が入っていればエージェントのセッションは動き続け、次回起動時に「再起動を生き延びたセッション」に出ます。無ければサーバと一緒に終わります。",
      confirmButton: "終了する",
      cancel: "キャンセル",
      stopping: "終了しています…",
      failed: "サーバを停止できませんでした。",
      stoppedTitle: "MulmoTerminal を終了しました",
      stoppedBody: "このタブは閉じて構いません。",
    },

    language: {
      intro:
        "このアプリ自身のボタンやラベルの言語です。配色と同じくブラウザごとに保存されるので、スマホと PC で別々にできます。エージェントが書く内容やターミナルの表示は変わりません。",
      picker: "このアプリの言語",
      auto: "ブラウザの言語にあわせる",
      autoResolved: "このブラウザは {locale} を要求しているので、{label} で表示されます。",
      partial: "いまのところ訳されているのは設定画面だけです。ほかの画面は英語のままです。",
    },
  },
};
