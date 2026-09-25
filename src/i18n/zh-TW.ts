import type { Messages } from "./messages";
import { blueprintsZhTW } from "./blueprints/zh-TW";

// 繁體中文。`Messages` 就是 en.ts 的形狀，少一個鍵就會編譯失敗 —— 不會出現執行時悄悄退回
// 英文、卻沒有人發現的狀況。
//
// 有些詞保持英文。產品名、config.json 裡的鍵名、skill 的名字都與文件一一對應，翻過來反而
// 讓讀者不知道該搜什麼。
//
// 這不是 zh-CN.ts 的字形轉換：兩邊的詞彙本來就不同（軟體 / 软件，程式 / 程序，網路 /
// 网络，設定 / 设置，預設 / 默认，檔案 / 文件），逐字轉換會得到一份沒有人這樣寫的中文。
export const zhTW: Messages = {
  settings: {
    title: "設定",
    close: "關閉",
    closeAria: "關閉設定",
    sectionsNav: "設定區段",
    sectionPicker: "設定區段",

    groups: {
      appearance: "外觀",
      projects: "專案",
      launch: "標頭與啟動",
      input: "輸入",
      models: "模型與伺服器",
      notifications: "通知",
      integrations: "整合",
      sessions: "工作階段",
      help: "說明",
    },

    tabs: {
      language: "語言",
      theme: "配色主題",
      font: "終端機字型",
      fontSize: "終端機字級",
      scroll: "終端機捲動速度",
      waitingRows: "等待中的列",
      gridHeader: "網格標頭顯示",
      toolbarPins: "工具列釘選",
      dirAppearance: "目錄外觀",
      dirSettings: "目錄設定",
      launchers: "啟動指令",
      headerChrome: "標頭按鈕與資訊標籤",
      terminalKeys: "終端機按鍵",
      shortcuts: "鍵盤快速鍵",
      voice: "語音輸入",
      models: "模型與後端",
      mcp: "MCP 伺服器",
      sounds: "通知音效",
      push: "Web Push 通知",
      quickCommands: "手機常用語",
      github: "GitHub 與 GitLab",
      prRepos: "Pull Request 的儲存庫",
      google: "Google 帳號",
      sessions: "工作階段與背景作業",
      surviving: "重啟後仍存活的工作階段",
      cost: "費用（估算）",
      quit: "結束 MulmoTerminal",
      help: "說明與使用者指南",
    },

    terminalKeys: {
      copyOnSelect: "選取一結束就複製",
      copyOnSelectTitle: "選取即複製",
      copyOnSelectHint: "滑鼠選取一結束就進剪貼簿，不必按任何鍵。這是唯一一個「你只想反白」卻會改寫剪貼簿的設定。",
      questionPane: "在側邊窗格回答問題",
      questionPaneTitle: "提問窗格",
      questionPaneHint:
        "工作階段向你提問時，把選項做成按鈕放在終端機旁邊的窗格裡。按一個，等於在終端機已經顯示的對話框裡按下對應的鍵，所以你照樣可以在終端機那邊回答。",
      enterTitle: "Enter 鍵",
      enterHint: "終端機裡執行的 Claude Code 把哪串位元組讀成「送出」。請與你的 Claude 設定一致；它只作用在 Claude 的工作階段，shell 的 Enter 不受影響。",
      enterField: "在 Claude 工作階段中代表送出的位元組",
      modes: {
        cr: "Enter 送出，Option/Alt+Enter 換行（預設）",
        "esc-cr": "Option/Alt+Enter 送出，Enter 換行",
      },
    },

    shortcuts: {
      intro:
        "唯讀；不論有沒有綁定，全都列在 {keymapKey} 底下。可以綁定兩類：MulmoTerminal 的操作（放大、跳到正在等你的代理程式、複製 / 貼上），以及送給終端機的按鍵序列（在 Mac 上用 Cmd+← 跳到行首）。你綁定的每個鍵都不再傳給終端機裡的程式，所以請用下面的按鈕來設定 —— 代理程式會先對照你既有的綁定，以及瀏覽器和 Mac 各自帶來的陷阱，然後才寫入。參考資料見{guide}。",
      guide: "指南",
      actions: {
        zoomToggle: "放大 / 收合一個終端機",
        zoomNext: "放大下一個終端機",
        zoomPrev: "放大上一個終端機",
        focusNext: "把游標移到下一個終端機（僅網格檢視）",
        focusPrev: "把游標移到上一個終端機（僅網格檢視）",
        nextAttention: "跳到正在等你的終端機",
        terminalNew: "開啟啟動面板",
        terminalNewHere: "在這個終端機的目錄下開啟啟動面板",
        terminalNewAdjacent: "直接在這個終端機的目錄下開一個 shell",
        terminalClose: "關閉這個終端機",
        terminalRestart: "重新啟動這個終端機裡的代理程式",
        filesFind: "在這個終端機旁邊，依檔名開啟檔案",
        filesSearch: "在這個終端機旁邊，搜尋檔案內容",
        copy: "複製終端機裡選取的內容",
        paste: "貼到終端機",
      },
      list: "鍵盤快速鍵",
      notSet: "未設定",
      sendRow: "把 {key} 送到終端機",
      sendNone: "把按鍵送到終端機",
      setUp: "設定快速鍵…",
    },

    surviving: {
      intro:
        "終端機活得比伺服器久，所以這些是上一次執行留下、現在還在跑的。{whatever}都會列出來 —— 包括你已經不再開啟的目錄，以及 shell，後者在這裡以外的任何清單都看不到。停掉一列只結束那一個工作階段：留有對話紀錄的，之後還能從它自己的目錄恢復。",
      whatever: "不論屬於哪個目錄",
      shellOrUnknown: "shell 或不明",
      unknownAgentTitle: "這個鍵底下沒有記錄到代理程式的對話 —— 可能是 shell、啟動指令，或是這台伺服器對應不回去的代理程式",
      lastActive: "最後活動於 {when}",
      loading: "正在讀取存活的工作階段…",
      failed: "讀不出來 —— tmux 可能沒有在執行。",
      unknownDir: "目錄不明",
      unknownDirTitle: "這台伺服器從沒看過它在哪裡執行",
      notResumable: "無法恢復",
      notResumableTitle: "磁碟上沒有可以用來恢復它的東西",
      doomed: "將被自動結束",
      doomedTitle: "沒有任何東西在用它，而且已經安靜了 {days} 天 —— 下一次清掃會結束它",
      open: "● 使用中",
      openTitle: "有終端機正佔著它 —— 請到那邊關閉",
      stopTitle: "停止這個工作階段",
      stopAria: "停止 {dir} 裡的工作階段",
      stopAriaUnknown: "一個不明的目錄",
      none: "沒有 —— 沒有從上一次伺服器留下來還在執行的東西。",
      reapStepper: "結束一個工作階段前允許的閒置天數",
      reapUnit: "天",
      sweepStepper: "清掃重複的間隔",
      sweepUnit: "小時",
      sweepHint: "已儲存：每 {hours} 小時重複一次。",
      sweepOffTitle: "已儲存：只在伺服器啟動時執行。",
      sweepOffHint: "一直開著的伺服器之後就再也不會去看了 —— 想讓它重複就把這個調大。",
      sweepDisabledHint: "上面的清掃本身是關掉的，所以這裡沒有可重複的東西。",
      sweepRunning: "本伺服器每 {hours} 小時重複一次清理。",
      sweepRunningOff: "本伺服器僅在啟動時清理一次，不會重複。",
      sweepPending: "上面儲存的間隔將從下次啟動開始生效。",
      sweepNote: "這個間隔在伺服器啟動時讀取，所以在這裡改動要下次啟動才生效。",
      neverTitle: "永不自動結束。",
      neverHint: "它們會一直留著，直到你在這裡停掉，或是從佔著它的終端機把它結束。",
      reapHint: "沒有任何東西在用 —— 沒人連線、這麼久沒有輸出 —— 的工作階段{ended}。它的對話會保留。設成 0 就永不自動結束。",
      reapEnded: "會在下一次清掃時結束",
    },

    sounds: {
      intro: "哪些時刻要響，以及各自響什麼。把通知變成噪音的，正是同時跑很多代理程式 —— 不需要的就取消勾選。工具列上的喇叭按鈕可以一次把它們全部靜音。",
      beepAria: "工作階段{kind}時發出聲音",
      soundFor: "{label} 的音效",
      playFor: "播放 {label} 的音效",
      default: "預設",
      defaultTitle: "預設",
      defaultHint: "播放你在下面指定的檔案；留空時播放內建提示音。預設音效只抓一次並留在這台機器上，所以離線也能用。",
      fileField: "自訂通知音效檔",
      browse: "瀏覽…",
      useChime: "改用內建提示音",
      useChimeTitle: "使用內建提示音",
      outro: "這裡設定的是所有工作階段共用的音效。用 skill 還能給某個專案自己的音效、挑出哪些時刻要推播到手機，並弄清楚其中哪一個才是把你吵醒的那個。",
      configure: "設定通知…",
      kinds: {
        finished: "一輪結束",
        waiting: "正在等你",
        "command-done": "指令執行完畢",
        "command-failed": "指令失敗",
        "session-exited": "工作階段結束",
        "worker-failed": "背景作業失敗",
        "pr-ci-failed": "PR 的 CI 失敗",
      },
      help: {
        finished: "代理程式已回覆，輸出還沒被讀",
        waiting: "它停下來發問了 —— 權限確認或一個問題",
        "command-done": "Run 格子的指令正常結束",
        "command-failed": "Run 格子的指令以錯誤結束，或者根本沒啟動",
        "session-exited": "工作階段的終端機結束了 —— 包括你自己關掉格子的情況",
        "worker-failed": "背景作業沒跑完就結束了 —— 它在畫面上沒有終端機，所以除此之外沒有別的東西會告訴你",
        "pr-ci-failed": "某個目錄的 PR 變紅了。只有在 roster 顯示著的時候才看得到，因為輪詢的就是它",
      },
    },

    guide: {
      prompt: "不確定 MulmoTerminal 怎麼用？看看指南 ——",
    },

    push: {
      intro: "背景作業完成時，向你註冊過的裝置推播。需要 {remoteHost} 連線 —— 通知的驗證來自它的登入，所以只有在連線時才會送出。",
      remoteHost: "RemoteHost",
      master: "向我的裝置發送 Web Push",
      masterLabel: "通知我的裝置",
      whichMoments: "哪些時刻值得推播：",
      kindAria: "工作階段{kind}時推播",
      kinds: {
        finished: "一輪結束",
        waiting: "正在等你",
      },
      help: {
        finished: "代理程式已回覆，輸出還沒被讀",
        waiting: "它停下來發問了 —— 權限確認或一個問題。每次提問推一次，所以愛發問的工作會推很多",
      },
    },

    github: {
      issueComments: "在格子正在處理的 issue 上留言",
      issueCommentsTitle: "說明某個 issue 已經開始做了",
      issueCommentsHint:
        "只有一則留言：開工時貼出，PR 開啟和合併時改寫。它寫的是工作目錄（只有資料夾名稱，絕不寫路徑），這樣兩個終端機就不會把同一個 issue 做兩遍。需要 {gh}（或 {glab}）處於登入狀態。",
      prFooter: "在建立的 PR 末尾寫上 clone 名稱",
      prFooterHint: "在內文底部加一行 {line}，這樣並排放著好幾個 clone 時，PR 能說明自己出自哪一個。",
      gitlabTitle: "自架 GitLab",
      gitlabHint: "光看 URL 看不出這台主機跑的是哪種 forge，所以在這裡宣告，它的儲存庫就會用 {glab} 來讀。需要 {authCommand}。下次伺服器啟動時生效。",
      gitlabField: "新增一台自架 GitLab 主機",
    },

    sessions: {
      summary: "讓回覆以一段總結收尾",
      summaryHint:
        "依規則寫出：被要求做什麼、做到了什麼、沒做到什麼。它是為網格而存在的 —— 過一陣子回到某個格子時，沒有它就只能把整個工作階段捲一遍才找得回來。只對從現在起開始的工作階段生效；目錄自己的 {dirFile} 優先於這裡。",
      digest: "保留一份決策摘要",
      digestTitle: "保留一份這個專案定下來的事情的摘要",
      digestHint: "一個 Markdown 檔，代理程式在問起專案已經定好的事情之前可以先讀它。寫在 {dir} 底下。",
      worklog: "定期記錄開發工作紀錄",
      worklogHint: "把你存過的各個工作目錄裡最近的工作，彙整成每週的 wiki 頁面。每次執行都會起一個 LLM 工作階段，所以要花 token。",
      worklogInterval: "多久執行一次：",
      worklogStepper: "開發工作紀錄的間隔",
      systemTasks: "內建的排程作業",
      systemTasksHint: "兩個都每小時執行一次，不關就一直開著。關掉其中一個要等伺服器下次啟動才生效。",
      feedRefresh: "重新整理集合與訂閱來源",
      feedRefreshHint: "抓取你的 RSS/JSON 訂閱來源，並派送由 skill 支撐的集合更新，涵蓋工作區和每個存過的專案目錄。一個訂閱來源都沒註冊時它什麼也不做。",
      calendarSync: "同步 Google 日曆",
      calendarSyncHint: "把有變動的行程拉進任何宣告了 Google 日曆的集合。在你連結帳號之前它什麼也不做。",
    },

    launchers: {
      intro:
        "任何可以在網格格子裡跑的互動式指令 —— 開發伺服器、REPL、git 介面、模型橋接。它在格子的目錄下以常駐終端機執行，一字不差照你寫的跑。例：{labelExample} → {commandExample}。",
      notAnAgent: "要啟動代理程式，請在空的格子裡用 Agent Picker —— 啟動指令不會給你工作階段所需要的任何東西。",
      labelField: "啟動項標籤",
      labelPlaceholder: "標籤",
      commandField: "啟動指令",
      commandPlaceholder: "指令（例如 $SHELL）",
    },

    quickCommands: {
      intro:
        "你常送的句子，會在手機的終端機檢視裡做成小標籤。按一下只是把文字放進輸入框 —— 不按送出就不會送出去。標籤是它的門面，所以請寫短一點。例：{labelExample} → {textExample}。一種都不勾就到處都出現，或者只勾適合的那些 —— {gitStatus} 屬於 shell，不屬於 Claude。",
      labelField: "常用語的標籤",
      labelPlaceholder: "標籤",
      textField: "常用語的內容",
      textPlaceholder: "要插入的文字（例如 PR作って）",
      offerTo: "出現在：",
      offerToAgent: "出現在 {agent} 的工作階段裡",
      offerToNone: "（一個都不勾 = 所有種類）",
    },

    mcp: {
      intro:
        "{singleView}的 Claude 工作階段會載入的 HTTP MCP 伺服器（在內建 GUI 工具之外）。{idKey} 是伺服器名稱，{urlKey} 是它的 streamable-HTTP 端點。在 Docker 沙箱裡，{localhost} 的 URL 會自動改走 {dockerHost}。下一個 Claude 工作階段開始生效。",
      singleView: "單一檢視",
      idField: "MCP 伺服器 id",
      idPlaceholder: "id（例如 weather）",
      urlField: "MCP 伺服器 URL",
      urlPlaceholder: "https://… 或 http://localhost:PORT/mcp",
    },

    headerChrome: {
      intro:
        "終端機標頭那一排操作按鈕和資訊標籤。全域有{buttons}和{chips}；專案可以在自己的 {dirFile} 裡依 id 新增或取代，所以某個終端機實際顯示的是兩者合併的結果。",
      builtInButtons: "內建按鈕",
      noButtons: "沒有按鈕（已全部移除）",
      someButtons: "{count} 個按鈕",
      builtInChips: "內建資訊標籤",
      noChips: "沒有資訊標籤（已全部移除）",
      someChips: "{count} 個資訊標籤",
      setUp: "設定標頭按鈕…",
    },

    models: {
      intro:
        "工作階段可以跑在這些 Anthropic 相容後端上，來自 {configFile} 裡的 {providersKey}。目錄可以用自己 {dirFile} 裡的 {providerKey} / {modelKey} 固定一個。金鑰放在環境變數裡，絕不寫進設定檔。",
      modelCount: "{count} 個模型",
      keyIn: "金鑰在 {env}",
      notReady: "無法使用",
      notInPicker: "不在選擇器裡",
      ready: "可以使用",
      noProviders: "尚未設定 —— 工作階段跑在內建預設值上。",
      customTitle: "用你自己的方式啟動 Claude Code",
      customIntro:
        "—— 會和內建的代理程式以及 Shell 一起出現在 Agent Picker 裡。它不是啟動指令：Claude Code 自己的參數會接在指令後面，所以這個格子照樣能恢復工作階段、回報費用、用上 GUI 工具，和其他 Claude 工作階段一樣。",
      noCustomAgents: "尚未設定。",
      accountsTitle: "其他訂閱",
      accountsIntro:
        "— Claude Code 或 Codex 的另一個登入，各自使用獨立的設定目錄。新儲存格可以在啟動表單中選擇帳戶啟動，其標題列會顯示該帳戶。工作階段始終留在啟動時的帳戶上。",
      noAccounts: "尚未設定 — 所有儲存格都使用預設登入。",
      addBackend: "新增一個後端…",
    },

    common: {
      add: "新增",
      remove: "移除 {name}",
    },

    dirAppearance: {
      intro:
        "啟動 {skill} skill 來安排目錄的樣子和順序 —— 名稱徽章、圖示、顏色、終端機配色、在網格裡的位置。它從你實際會開啟的目錄出發，讀取你既有的設定，對還沒有設定的那些也照同樣的路子來。",
      configure: "設定外觀…",
      favicon: "使用專案自己的 favicon",
      faviconHint:
        "沒有設定 {iconKey} 的目錄，會顯示它的儲存庫本來就有的圖（{svg}、{png}、web manifest）。不想要的專案在自己的 {dirFile} 裡寫 {iconFalse}，這個開關不會蓋掉它。",
    },

    dirSettings: {
      intro:
        "每個目錄的 {dirFile} 實際上在做什麼。展開一列就能看到正在生效的值，以及應用程式丟掉或根本不認識的鍵 —— 在能看到這個之前，一個從沒生效的設定和一個你壓根沒寫過的設定長得一模一樣。",
      outro: "這裡列的是哪裡不對勁；skill 讀的是同一份東西，它會說明原因，然後修好，或者把你帶到管那個鍵的 skill 那裡。",
      explain: "幫我說明我的設定…",
    },

    google: {
      intro:
        "連結一個 Google 帳號，{tool} 工具和你的手機就能讀取和建立{calendar}行程。登入會在新分頁開啟，並在{thisMachine}上完成，所以請用這邊的瀏覽器；如果是遠端連線，請改為執行 {cli}。這個連結與 MulmoClaude 共用。",
      calendar: "日曆",
      thisMachine: "這台機器",
      checking: "檢查中…",
      pending: "正在等你在瀏覽器裡授權…",
      linked: "已連結",
      notLinked: "未連結",
      signIn: "用 Google 登入",
      unlink: "解除連結",
      confirmUnlink: "要解除這個 Google 帳號的連結嗎？在你重新登入之前，MulmoTerminal 將無法存取日曆。",
      secretMissing:
        "在 ~/.secrets 裡找不到 OAuth 用戶端密鑰。把桌面用戶端的 client_secret_*.json 放進去就能登入；如果可用，也可以走不必設定 GCP 的 broker 連結。",
      secretAmbiguous: "~/.secrets 裡有多個 client_secret_*.json —— 請只留一個。",
    },

    prRepos: {
      intro: "跨儲存庫的{view}檢視會列出這些儲存庫裡開著的 PR。使用你的 {gh} 登入。格式：{format}。",
      view: "Pull Request",
      field: "新增一個儲存庫（owner/repo）",
    },

    skillLaunch: {
      hint: "這件事由代理程式替你做 —— 它會問幾個問題，然後自己改設定檔。",
    },

    skillConfirm: {
      title: "讓代理程式來設定嗎？",
      what: "網格裡會開啟一個新終端機，{agent} 在那裡啟動 —— 它會問你幾個問題，然後自己改設定檔。",
      howToStop: "想停下來，就用關閉按鈕關掉那個終端機 —— 工作階段在那裡結束。設定隨時都能從工具列重新開啟。",
      launchWith: "用誰啟動",
      launchWithAria: "用來啟動這個 skill 的代理程式 —— 與集合聊天用的是同一個選擇",
      cancel: "取消",
      start: "開始",
    },

    version: {
      label: "版本",
      commit: "commit {sha}",
    },

    voice: {
      intro: "你口述時使用的語言。用麥克風沒有預期的語言說話，回來的會是被{translated}成預期語言的結果 —— 所以請選你實際說的那個，而不是放著用瀏覽器的。",
      translated: "翻譯",
      picker: "語音輸入的語言",
      browserLanguage: "跟著瀏覽器的語言",
      detect: "依我說的內容判斷",
      always: "一律使用這個語言",
    },

    stepper: {
      decrease: "減少{label}",
      increase: "增加{label}",
    },

    theme: {
      missing: "選取的主題 {id} 沒有定義。請把它加到 {configFile} 的 {themesKey} 裡，或者在下面選一個。在那之前會保留你的選擇。",
      intro:
        "從既有的配色裡選。你自己的寫在 {configFile} 的 {themesKey} 裡，就會出現在這裡，和內建的四個並排 —— skill 能從一組色票、一張照片或一個品牌的顏色寫出一套，並檢查對比。",
      group: "主題",
      create: "建立一個主題…",
    },

    font: {
      intro:
        "所有終端機算繪時使用的 CSS font-family 堆疊。CJK 文字看起來不對的時候就動它 —— 排在最前面的字型沒有日文字形時會逐字退回，行就對不齊了。留空則使用內建的堆疊。目錄可以用自己 {dirFile} 裡的 {key} 固定一套。",
      field: "終端機的 font-family 堆疊",
      apply: "套用",
      invalid: "這不是一個字型堆疊。名稱之間用逗號分開 —— {example}。CSS 的語法字元和沒成對的引號會被拒絕，因為只要有一項寫壞，整條宣告就作廢了。",
      hint: "一套用，開著的終端機就會重新排版 —— 換一種字型，字元前進寬度就不同，否則網格會和畫布錯開。你沒有寫通用字族時會自動補上 {mono}，這樣即使整個堆疊都對不到，也還能退回等寬字型。",
    },

    fontSize: {
      stepper: "終端機字級",
      hint: "對這個瀏覽器上的每一個終端機生效。目錄可以用自己 {dirFile} 裡的 {key} 固定一個。",
    },

    scroll: {
      stepper: "終端機捲動速度",
      hint: "滾輪一格、或觸控板滑一次，終端機走多遠 —— 預設是 1×。如果在 Mac 觸控板上雙指一滑就衝過了你正在讀的地方，就把它調小。依瀏覽器保存，對 shell 的捲動紀錄和 Claude Code 這類全螢幕應用程式都生效。",
      returnLabel: "送出時回到最新的輸出",
      returnHint:
        "按下 Enter（或送出按鈕）時，把已經往上捲的終端機帶回底部，就像一般終端機那樣。shell 本來就是這個行為；Claude Code 這類全螢幕代理程式自己管著捲動位置，所以不會 —— 這個開關正好把你剛才捲的那段收回來。想在一輪執行時停在正在讀的地方，就把它關掉。",
    },

    toolbarPins: {
      intro:
        "你釘選過的集合和訂閱來源，也可以直接放在工具列上，和 Grid、Collections 並排 —— 按一下就到，不必先開 Collections 再到頂端那一列裡找。最多選 {max} 個；一個都不選時工具列維持原樣。",
      empty: "還沒有釘選任何東西。請先開啟 Collections，在那裡釘選一個集合或訂閱來源 —— 這份清單提供的就是你釘選過的。",
      unavailable: "釘選清單無法使用（{error}），所以這裡沒有東西可以提供。工具列會繼續顯示它原本顯示的內容；等清單恢復後再開啟這裡。",
      full: "上限是 {max} 個。清掉一個騰出位置 —— 超過幾個之後，它們就會把工具列本來承載的東西擠出去。",
    },

    gridHeader: {
      intro: "網格上方那條列一眼能告訴你什麼，就在它已經帶著的 Claude 和 Codex 用量視窗旁邊。",
      loadAverage: "顯示這台機器的 load average",
      loadAverageTitle: "Load average",
      loadAverageHint:
        "跑著你的工作階段的那台機器的負載，以核心數的百分比表示 —— 100% 意味著每個核心都有排隊的工作，這時再起一個代理程式會讓已經在跑的變慢。100% 轉琥珀色，200% 轉紅色。不保留 load average 的主機（Windows）無論如何都不顯示。",
    },

    waitingRows: {
      intro:
        "在放大格子旁邊的清單裡，代理程式{waiting}的列 —— 權限確認、一個問題 —— 會帶琥珀色外環並閃爍。只是{finished}的列是綠色而且靜止的。關掉它會保留兩種顏色、只停掉動作；當你的系統要求減少動態效果時，這些列本來就不閃。",
      waiting: "正在等你",
      finished: "結束了",
      blink: "讓正在等我的列閃爍",
      linesTitle: "每列的行數",
      linesHint: "每一列在截斷之前顯示多少。調高是拿螢幕上能放下多少個工作階段，去換在原地讀完一個長的。",
      fields: {
        summary: "摘要",
        prompt: "你的輸入",
        response: "最近一次回覆",
      },
      steppers: {
        summary: "摘要的行數",
        prompt: "你的輸入的行數",
        response: "最近一次回覆的行數",
      },
    },

    cost: {
      intro:
        "依{pricing}（輸入、輸出和快取 token）估算的這個專案的花費 —— 實際帳單可能不同，定額方案（Max）的用量也不會反映出來。Today / Month 彙整的是這個專案的工作階段。",
      pricing: "公開的各模型價格",
      group: "預估費用",
      groupTitle: "依公開的各模型價格估算；實際帳單可能不同。",
      session: "本次工作階段",
      today: "今天",
      month: "本月",
      failed: "讀不到費用估算。",
      unpriced: "有些輪次用的模型沒有已知價格，已從這些估算中排除。",
    },

    quit: {
      description:
        "停止這台機器上執行的 MulmoTerminal 伺服器。關掉這個分頁並不會停掉它 —— 伺服器還在跑，而這裡就是不必回到當初啟動它的那個終端機也能停掉它的辦法。",
      // Message-function form, which skips vue-i18n's message compiler: the literal `@` in
      // `mulmoterminal@latest` would otherwise be read as a linked-message reference, the compiler
      // throws, and the whole section renders as nothing.
      restartHint: () => "要再啟動一次，請在終端機裡執行 `npx mulmoterminal@latest`。",
      button: "結束 MulmoTerminal",
      confirmBody: "伺服器會停止，這個頁面將無法運作。網格上的每一個終端機都會從畫面上消失。",
      sessionsNote:
        "和按 Ctrl+C 一樣：裝了 tmux 的話，代理程式的工作階段會繼續跑，下次會出現在「重啟後仍存活的工作階段」裡；沒裝的話，它們會隨伺服器一起結束。",
      confirmButton: "結束",
      cancel: "取消",
      stopping: "正在停止…",
      failed: "沒能停止伺服器。",
      stoppedTitle: "MulmoTerminal 已停止",
      stoppedBody: "你可以關閉這個分頁了。",
    },

    language: {
      intro:
        "這個應用程式自己的按鈕和標籤所用的語言。像主題一樣依瀏覽器保存 —— 手機和電腦可以各用各的。它不會影響你的代理程式寫什麼，也不會影響終端機裡顯示什麼。",
      picker: "這個應用程式的語言",
      auto: "跟著瀏覽器的語言",
      autoResolved: "你的瀏覽器要的是 {locale}，所以這裡以 {label} 顯示。",
      partial: "目前翻譯過的是設定畫面，以及網格上的狀態詞。應用程式的其餘部分仍然是英文。",
    },
  },

  // 網格與名冊上常駐的狀態詞（#2182）—— 停留在畫面上時間最長的字串。
  //
  // 元件一律透過 `Record<狀態, 鍵>` 取用，而非以狀態名組出鍵。這正是重點：為
  // `AttentionStatus` / `WorkPhase` / `PrPhase` 增加取值時，必須在此處寫上名稱，否則無法通過
  // 編譯（#1894）。
  status: {
    attention: {
      working: "執行中",
      blocked: "等待輸入",
      done: "完成",
      idle: "閒置",
    },
    work: {
      planning: "規劃中",
      implementing: "編輯中",
    },
    cell: {
      blocked: "需要輸入",
      done: "完成 — 待檢視",
      working: "執行中…",
      idle: "閒置",
    },
    cellMissedNotify: "{label}（提示音未能播放，可能已錯過）",

    // `label` 保留 GitHub 自身的用語：PR 頁面就用這些詞，徽章也沒有容納譯文的寬度，而讓徽章能與
    // GitHub 對上本就是它的用途。`title` / `state` 是句子，予以翻譯。`title` 獨立使用，
    // `state` 用於已經點名 PR 的位置，混用會得到 `PR #2689 · PR — CI running`（#1235）。
    pr: {
      draft: { label: "draft", title: "草稿 PR", state: "草稿" },
      "ci-failing": { label: "CI fail", title: "PR — CI 失敗", state: "CI 失敗" },
      "changes-requested": { label: "changes", title: "PR — 請求變更", state: "請求變更" },
      "ci-running": { label: "CI…", title: "PR — CI 執行中", state: "CI 執行中" },
      ready: { label: "ready", title: "可合併的 PR", state: "可合併" },
      merged: { label: "merged", title: "PR 已合併", state: "已合併" },
      closed: { label: "closed", title: "PR 已關閉", state: "已關閉" },
    },
  },

  issueStart: {
    agentLabel: "用於開始 Issue",
    accountLabel: "帳戶",
    defaultLogin: "預設登入",
    notInstalled: "{agent}（未安裝）",
    runsAtOnce: "{agent} 啟動後會立即執行 Issue 內文。任何能撰寫該 Issue 的人都可以左右它的行為。",
    runsAtOnceAutoApproved: "{agent} 啟動後會立即執行 Issue 內文，並自動核准其工具的使用。任何能撰寫該 Issue 的人都可以左右它的行為。",
  },

  launch: {
    agentUnavailable: {
      missing: "此電腦上未安裝 {agent}，因此無法在此啟動。",
      noSuchPath: "{agent} 的命令覆寫設定指向的檔案不存在，因此無法啟動。",
      notExecutable: "已找到 {agent} 的命令，但無法執行。",
      installGuide: "安裝指南",
      restartNote: "處理完成後，請重新啟動 MulmoTerminal。",
    },
  },

  terminal: {
    copyMode: {
      message: "正在檢視歷史 — 輸入不會送到終端機。按 q 返回。",
      exit: "返回輸入",
    },
  },
  blueprints: blueprintsZhTW,
};
