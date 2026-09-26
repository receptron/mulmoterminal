import type { Messages } from "./messages";

// 简体中文。`Messages` 就是 en.ts 的形状，少一个键就会编译失败 —— 不会出现运行时悄悄回退到
// 英文、而谁都没发现的状态。
//
// 有些词保持英文。产品名、config.json 里的键名、skill 的名字都与文档一一对应，译过来反而
// 让读者不知道该去搜什么。繁体中文见 zh-TW.ts —— 两者词汇本身不同（软件 / 軟體，程序 /
// 程式，网络 / 網路），不是字形转换。
export const zhCN: Messages = {
  settings: {
    title: "设置",
    close: "关闭",
    closeAria: "关闭设置",
    sectionsNav: "设置分区",
    sectionPicker: "设置分区",

    groups: {
      appearance: "外观",
      projects: "项目",
      launch: "头部与启动",
      input: "输入",
      models: "模型与服务",
      notifications: "通知",
      integrations: "集成",
      sessions: "会话",
      help: "帮助",
    },

    tabs: {
      language: "语言",
      theme: "配色主题",
      font: "终端字体",
      fontSize: "终端字号",
      scroll: "终端滚动速度",
      waitingRows: "等待中的行",
      gridHeader: "网格顶栏显示",
      toolbarPins: "工具栏固定项",
      dirAppearance: "目录外观",
      dirSettings: "目录设置",
      launchers: "启动命令",
      headerChrome: "头部按钮与信息条",
      terminalKeys: "终端按键",
      shortcuts: "键盘快捷键",
      voice: "语音输入",
      models: "模型与后端",
      mcp: "MCP 服务器",
      sounds: "提示音",
      push: "Web Push 通知",
      quickCommands: "手机常用短语",
      github: "GitHub 与 GitLab",
      prRepos: "拉取请求的仓库",
      google: "Google 账号",
      sessions: "会话与后台任务",
      surviving: "重启后仍存活的会话",
      cost: "费用（估算）",
      quit: "退出 MulmoTerminal",
      help: "帮助与用户指南",
    },

    terminalKeys: {
      copyOnSelect: "选中一结束就复制",
      copyOnSelectTitle: "选中即复制",
      copyOnSelectHint: "鼠标选中一结束就进剪贴板，不用按任何键。这是唯一一个「你只想高亮」却会改写剪贴板的设置。",
      questionPane: "在侧边栏回答提问",
      questionPaneTitle: "提问面板",
      questionPaneHint: "会话向你提问时，把选项做成按钮放在终端旁边的面板里。点一个，等于在终端已经显示的对话框里按下对应的键，所以你照样可以在终端那边回答。",
      enterTitle: "Enter 键",
      enterHint: "终端里运行的 Claude Code 把哪串字节读作「提交」。请与你的 Claude 配置保持一致；它只作用于 Claude 会话，shell 的 Enter 不受影响。",
      enterField: "在 Claude 会话中代表提交的字节",
      modes: {
        cr: "Enter 提交，Option/Alt+Enter 换行（默认）",
        "esc-cr": "Option/Alt+Enter 提交，Enter 换行",
      },
    },

    shortcuts: {
      intro:
        "只读；不管有没有绑定，全都列在 {keymapKey} 下面。可以绑定两类：MulmoTerminal 的操作（放大、跳到在等你的智能体、复制 / 粘贴），以及发送给终端的按键序列（在 Mac 上用 Cmd+← 跳到行首）。你绑定的每个键都不再传给终端里的程序，所以请用下面的按钮来设置 —— 智能体会先对照你已有的绑定，以及浏览器和 Mac 各自带来的陷阱，然后才写入。参考资料见{guide}。",
      guide: "指南",
      actions: {
        zoomToggle: "放大 / 收起一个终端",
        zoomNext: "放大下一个终端",
        zoomPrev: "放大上一个终端",
        focusNext: "把光标移到下一个终端（仅网格视图）",
        focusPrev: "把光标移到上一个终端（仅网格视图）",
        nextAttention: "跳到在等你的终端",
        terminalNew: "打开启动面板",
        terminalNewHere: "在这个终端的目录下打开启动面板",
        terminalNewAdjacent: "直接在这个终端的目录下开一个 shell",
        terminalClose: "关闭这个终端",
        terminalRestart: "重启这个终端里的智能体",
        filesFind: "在这个终端旁边，按文件名打开文件",
        filesSearch: "在这个终端旁边，搜索文件内容",
        copy: "复制终端里选中的内容",
        paste: "粘贴到终端",
      },
      list: "键盘快捷键",
      notSet: "未设置",
      sendRow: "把 {key} 发送到终端",
      sendNone: "把按键发送到终端",
      setUp: "设置快捷键…",
    },

    surviving: {
      intro:
        "终端比服务器活得久，所以这些是上一次运行留下、现在还在跑的。{whatever}都会列出来 —— 包括你已经不再打开的目录，以及 shell，后者在这里之外的任何列表都看不到。停掉一行只结束那一个会话：留有对话记录的，之后还能从它自己的目录里恢复。",
      whatever: "不管属于哪个目录",
      shellOrUnknown: "shell 或未知",
      unknownAgentTitle: "这个键下没有记录到智能体的对话 —— 可能是 shell、启动命令，或者这台服务器无法对应回去的智能体",
      lastActive: "最后活动于 {when}",
      loading: "正在读取存活的会话…",
      failed: "读不出来 —— tmux 可能没有在运行。",
      unknownDir: "目录未知",
      unknownDirTitle: "这台服务器从没见过它在哪里运行",
      notResumable: "无法恢复",
      notResumableTitle: "磁盘上没有可以用来恢复它的东西",
      doomed: "将被自动结束",
      doomedTitle: "没有任何东西在用它，而且已经安静了 {days} 天 —— 下一次清扫会结束它",
      open: "● 使用中",
      openTitle: "有终端正占着它 —— 请到那边关闭",
      stopTitle: "停止这个会话",
      stopAria: "停止 {dir} 里的会话",
      stopAriaUnknown: "一个未知的目录",
      none: "没有 —— 没有从上一次服务器留下来还在运行的东西。",
      reapStepper: "结束一个会话前允许的空闲天数",
      reapUnit: "天",
      sweepStepper: "清扫重复的间隔",
      sweepUnit: "小时",
      sweepHint: "已保存：每 {hours} 小时重复一次。",
      sweepOffTitle: "已保存：只在服务器启动时运行。",
      sweepOffHint: "一直开着的服务器之后就再也不会去看了 —— 想让它重复就把这个调大。",
      sweepDisabledHint: "上面的清扫本身是关掉的，所以这里没有可重复的东西。",
      sweepRunning: "本服务器每 {hours} 小时重复一次清理。",
      sweepRunningOff: "本服务器仅在启动时清理一次，不会重复。",
      sweepPending: "上面保存的间隔将从下次启动开始生效。",
      sweepNote: "这个间隔在服务器启动时读取，所以在这里改动要下次启动才生效。",
      neverTitle: "永不自动结束。",
      neverHint: "它们会一直留着，直到你在这里停掉，或者从占着它的终端里结束它。",
      reapHint: "没有任何东西在用 —— 没人连接、这么久没有输出 —— 的会话{ended}。它的对话会保留。设为 0 就永不自动结束。",
      reapEnded: "会在下一次清扫时结束",
    },

    sounds: {
      intro: "哪些时刻响，以及各自响什么。把通知变成噪音的，正是同时跑很多智能体 —— 不需要的就取消勾选。工具栏上的喇叭按钮可以一次把它们全部静音。",
      beepAria: "会话{kind}时响铃",
      soundFor: "{label} 的声音",
      playFor: "播放 {label} 的声音",
      default: "默认",
      defaultTitle: "默认",
      defaultHint: "播放你在下面指定的文件；为空时播放内置提示音。预设只取一次并保存在这台机器上，所以离线也能用。",
      fileField: "自定义提示音文件",
      browse: "浏览…",
      useChime: "改用内置提示音",
      useChimeTitle: "使用内置提示音",
      outro: "这里设置的是所有会话共用的声音。用 skill 还能给某个项目单独的声音、挑出哪些时刻推送到手机，并弄清楚其中哪一个才是把你吵醒的那个。",
      configure: "配置通知…",
      kinds: {
        finished: "一轮结束",
        waiting: "在等你",
        "command-done": "命令执行完毕",
        "command-failed": "命令失败",
        "session-exited": "会话结束",
        "worker-failed": "后台任务失败",
        "pr-ci-failed": "PR 的 CI 失败",
      },
      help: {
        finished: "智能体已回复，输出还没被读",
        waiting: "它停下来发问了 —— 权限确认或者一个问题",
        "command-done": "Run 单元格的命令正常退出",
        "command-failed": "Run 单元格的命令报错退出，或者根本没启动",
        "session-exited": "会话的终端结束了 —— 包括你自己关掉单元格的情况",
        "worker-failed": "后台任务没跑完就结束了 —— 它在屏幕上没有终端，所以除此之外没有别的东西会告诉你",
        "pr-ci-failed": "某个目录的 PR 变红了。只有在 roster 显示着的时候才看得到，因为轮询的就是它",
      },
    },

    guide: {
      prompt: "不确定 MulmoTerminal 怎么用？看看指南 ——",
    },

    push: {
      intro: "后台任务完成时，向你注册过的设备发送推送。需要 {remoteHost} 连接 —— 通知的鉴权来自它的登录，所以只在连接着的时候才会发出。",
      remoteHost: "RemoteHost",
      master: "向我的设备发送 Web Push",
      masterLabel: "通知我的设备",
      whichMoments: "哪些时刻值得推送：",
      kindAria: "会话{kind}时推送",
      kinds: {
        finished: "一轮结束",
        waiting: "在等你",
      },
      help: {
        finished: "智能体已回复，输出还没被读",
        waiting: "它停下来发问了 —— 权限确认或者一个问题。每次提问推一次，所以爱发问的任务会推很多",
      },
    },

    github: {
      issueComments: "在单元格正在处理的 issue 上留言",
      issueCommentsTitle: "说明某个 issue 已经开始做了",
      issueCommentsHint:
        "只有一条留言：开工时发出，PR 打开和合并时改写。它写的是工作目录（只有文件夹名，绝不写路径），这样两个终端就不会把同一个 issue 做两遍。需要 {gh}（或 {glab}）处于登录状态。",
      prFooter: "在创建的 PR 末尾写上克隆名",
      prFooterHint: "在正文底部加一行 {line}，这样并排放着好几个克隆时，PR 能说明自己出自哪一个。",
      gitlabTitle: "自建 GitLab",
      gitlabHint: "光看 URL 看不出这台主机跑的是哪种 forge，所以在这里声明，它的仓库就会用 {glab} 来读。需要 {authCommand}。下次服务器启动时生效。",
      gitlabField: "添加一台自建 GitLab 主机",
    },

    sessions: {
      summary: "让回复以一段总结收尾",
      summaryHint:
        "按规则写出：被要求做什么、做到了什么、没做到什么。它是为网格而存在的 —— 过一阵子回到某个单元格时，不这样就只能把整个会话滚一遍才找得回来。只对从现在起开始的会话生效；目录自己的 {dirFile} 优先于这里。",
      digest: "保留一份决策摘要",
      digestTitle: "保留一份这个项目定下来的事情的摘要",
      digestHint: "一个 Markdown 文件，智能体在问起项目已经定好的事情之前可以先读它。写在 {dir} 下面。",
      worklog: "定期记录开发工作日志",
      worklogHint: "把你保存过的各个工作目录里最近的工作，汇总成每周的 wiki 页面。每次运行都会起一个 LLM 会话，所以要花 token。",
      worklogInterval: "多久运行一次：",
      worklogStepper: "开发工作日志的间隔",
      systemTasks: "内置的定时任务",
      systemTasksHint: "两个都每小时运行一次，不关就一直开着。关掉某一个要等服务器下次启动才生效。",
      feedRefresh: "刷新集合与订阅源",
      feedRefreshHint: "拉取你的 RSS/JSON 订阅源，并派发由 skill 支撑的集合更新，覆盖工作区和每个保存过的项目目录。一个订阅源都没注册时它什么也不做。",
      calendarSync: "同步 Google 日历",
      calendarSyncHint: "把有变动的日程拉进任何声明了 Google 日历的集合。在你连接账号之前它什么也不做。",
    },

    launchers: {
      intro:
        "任何可以在网格单元格里跑的交互式命令 —— 开发服务器、REPL、git 界面、模型桥接。它在单元格的目录下作为常驻终端运行，一字不差地照你写的执行。例：{labelExample} → {commandExample}。",
      notAnAgent: "要启动智能体，请在空的单元格里用 Agent Picker —— 启动命令不会给你会话所需要的任何东西。",
      labelField: "启动项标签",
      labelPlaceholder: "标签",
      commandField: "启动命令",
      commandPlaceholder: "命令（例如 $SHELL）",
    },

    quickCommands: {
      intro:
        "你常发的短语，会在手机的终端视图里做成小标签。点一下只是把文字放进输入框 —— 不按发送就不会发出去。标签是它的脸面，所以请写短一点。例：{labelExample} → {textExample}。一种都不勾就到处都出现，或者只勾适合的那些 —— {gitStatus} 属于 shell，不属于 Claude。",
      labelField: "常用短语的标签",
      labelPlaceholder: "标签",
      textField: "常用短语的内容",
      textPlaceholder: "要插入的文字（例如 PR作って）",
      offerTo: "出现在：",
      offerToAgent: "出现在 {agent} 会话里",
      offerToNone: "（一个都不勾 = 所有种类）",
    },

    mcp: {
      intro:
        "{singleView}的 Claude 会话会加载的 HTTP MCP 服务器（在内置 GUI 工具之外）。{idKey} 是服务器名，{urlKey} 是它的 streamable-HTTP 端点。在 Docker 沙箱里，{localhost} 的 URL 会自动改走 {dockerHost}。下一个 Claude 会话开始生效。",
      singleView: "单视图",
      idField: "MCP 服务器 id",
      idPlaceholder: "id（例如 weather）",
      urlField: "MCP 服务器 URL",
      urlPlaceholder: "https://… 或 http://localhost:PORT/mcp",
    },

    headerChrome: {
      intro:
        "终端头部那一排操作按钮和信息条。全局有{buttons}和{chips}；项目可以在自己的 {dirFile} 里按 id 增加或替换，所以某个终端实际显示的是两者合并的结果。",
      builtInButtons: "内置按钮",
      noButtons: "没有按钮（已全部移除）",
      someButtons: "{count} 个按钮",
      builtInChips: "内置信息条",
      noChips: "没有信息条（已全部移除）",
      someChips: "{count} 个信息条",
      setUp: "设置头部按钮…",
    },

    models: {
      intro:
        "会话可以跑在这些 Anthropic 兼容后端上，来自 {configFile} 里的 {providersKey}。目录可以用自己 {dirFile} 里的 {providerKey} / {modelKey} 固定一个。密钥放在环境变量里，绝不写进配置文件。",
      modelCount: "{count} 个模型",
      keyIn: "密钥在 {env}",
      notReady: "不可用",
      notInPicker: "不在选择器里",
      ready: "可用",
      noProviders: "尚未配置 —— 会话跑在内置默认值上。",
      customTitle: "用你自己的方式启动 Claude Code",
      customIntro:
        "—— 会和内置的智能体以及 Shell 一起出现在 Agent Picker 里。它不是启动命令：Claude Code 自己的参数会接在命令后面，所以这个单元格照样能恢复会话、报告费用、用上 GUI 工具，和别的 Claude 会话一样。",
      noCustomAgents: "尚未配置。",
      accountsTitle: "其他订阅",
      accountsIntro:
        "— Claude Code 或 Codex 的另一个登录，各自使用独立的配置目录。新单元格可以在启动表单中选择账户启动，其标题栏会显示该账户。会话始终留在启动时的账户上。",
      noAccounts: "尚未配置 — 所有单元格都使用默认登录。",
      addBackend: "添加一个后端…",
    },

    common: {
      add: "添加",
      remove: "移除 {name}",
    },

    dirAppearance: {
      intro:
        "启动 {skill} skill 来安排目录的样子和顺序 —— 名字徽章、图标、颜色、终端配色、在网格里的位置。它从你实际会打开的目录出发，读取你已有的设置，对还没有设置的那些也按同样的路子来。",
      configure: "配置外观…",
      favicon: "使用项目自己的 favicon",
      faviconHint:
        "没有设置 {iconKey} 的目录，会显示它的仓库里本来就有的图（{svg}、{png}、web manifest）。不想要的项目在自己的 {dirFile} 里写 {iconFalse}，这个开关不会覆盖它。",
    },

    dirSettings: {
      intro:
        "每个目录的 {dirFile} 实际上在做什么。展开一行就能看到正在生效的值，以及应用丢掉或者根本不认识的键 —— 在能看到这个之前，一个从没生效的设置和一个你压根没写过的设置长得一模一样。",
      outro: "这里列的是哪里不对劲；skill 读的是同一份东西，它会说明原因，然后修好，或者把你带到管那个键的 skill 那里。",
      explain: "帮我解释我的设置…",
    },

    google: {
      intro:
        "关联一个 Google 账号，{tool} 工具和你的手机就能读取和创建{calendar}日程。登录会在新标签页打开，并在{thisMachine}上完成，所以请用这边的浏览器；如果是远程连接，请改为运行 {cli}。这个关联与 MulmoClaude 共用。",
      calendar: "日历",
      thisMachine: "这台机器",
      checking: "检查中…",
      pending: "正在等你在浏览器里授权…",
      linked: "已关联",
      notLinked: "未关联",
      signIn: "用 Google 登录",
      unlink: "解除关联",
      confirmUnlink: "要解除这个 Google 账号的关联吗？在你重新登录之前，MulmoTerminal 将无法访问日历。",
      secretMissing:
        "在 ~/.secrets 里找不到 OAuth 客户端密钥。把桌面客户端的 client_secret_*.json 放进去就能登录；如果可用，也可以走不需要配置 GCP 的 broker 关联。",
      secretAmbiguous: "~/.secrets 里有多个 client_secret_*.json —— 请只保留一个。",
    },

    prRepos: {
      intro: "跨仓库的{view}视图会列出这些仓库里打开着的 PR。使用你的 {gh} 登录。格式：{format}。",
      view: "拉取请求",
      field: "添加一个仓库（owner/repo）",
    },

    skillLaunch: {
      hint: "这件事由智能体替你做 —— 它会问几个问题，然后自己改配置文件。",
    },

    skillConfirm: {
      title: "让智能体来设置吗？",
      what: "网格里会打开一个新终端，{agent} 在那里启动 —— 它会问你几个问题，然后自己改配置文件。",
      howToStop: "想停下来，就用关闭按钮关掉那个终端 —— 会话在那里结束。设置随时都能从工具栏重新打开。",
      launchWith: "用谁启动",
      launchWithAria: "用来启动这个 skill 的智能体 —— 与集合聊天所用的是同一个选择",
      cancel: "取消",
      start: "开始",
    },

    version: {
      label: "版本",
      commit: "提交 {sha}",
    },

    voice: {
      intro: "你口述时使用的语言。用麦克风没有预期的语言说话，回来的会是被{translated}成预期语言的结果 —— 所以请选你实际说的那个，而不是放着用浏览器的。",
      translated: "翻译",
      picker: "语音输入的语言",
      browserLanguage: "跟随浏览器的语言",
      detect: "根据我说的内容判断",
      always: "始终使用这个语言",
    },

    stepper: {
      decrease: "减少{label}",
      increase: "增加{label}",
    },

    theme: {
      missing: "选中的主题 {id} 没有定义。请把它加到 {configFile} 的 {themesKey} 里，或者在下面选一个。在那之前会保留你的选择。",
      intro:
        "从已有的配色里选。你自己的写在 {configFile} 的 {themesKey} 里，就会出现在这里，和内置的四个并排 —— skill 能从一组色板、一张照片或者一个品牌的颜色里写出一套，并检查对比度。",
      group: "主题",
      create: "创建一个主题…",
    },

    font: {
      intro:
        "所有终端渲染时使用的 CSS font-family 栈。CJK 文字看起来不对的时候就动它 —— 排在最前面的字体没有日文字形时会逐字回退，行就对不齐了。留空则使用内置的栈。目录可以用自己 {dirFile} 里的 {key} 固定一套。",
      field: "终端的 font-family 栈",
      apply: "应用",
      invalid: "这不是一个字体栈。名字之间用逗号分开 —— {example}。CSS 的语法字符和不成对的引号会被拒绝，因为只要有一项写坏，整条声明就作废了。",
      hint: "一生效，开着的终端就会重新排布 —— 换一种字体，字符步进宽度就不同，否则网格会和画布错开。你没有写通用字体族时会自动补上 {mono}，这样即使整个栈都匹配不到，也还能回退到等宽字体。",
    },

    fontSize: {
      stepper: "终端字号",
      hint: "对这个浏览器上的每一个终端生效。目录可以用自己 {dirFile} 里的 {key} 固定一个。",
    },

    scroll: {
      stepper: "终端滚动速度",
      hint: "滚轮一格、或者触控板一次滑动，终端走多远 —— 默认是 1×。如果在 Mac 触控板上双指一滑就冲过了你正在读的地方，就把它调小。按浏览器保存，对 shell 的滚动历史和 Claude Code 这类全屏应用都生效。",
      returnLabel: "发送时回到最新输出",
      returnHint:
        "按下 Enter（或发送按钮）时，把已经往上滚的终端带回底部，就像普通终端那样。shell 本来就是这个行为；Claude Code 这类全屏智能体自己管着滚动位置，所以不会 —— 这个开关正好把你刚才滚的那段撤回来。想在一轮运行时停在正在读的地方，就把它关掉。",
    },

    toolbarPins: {
      intro:
        "你固定过的集合和订阅源，也可以直接放在工具栏上，和 Grid、Collections 并排 —— 按一下就到，不用先打开 Collections 再到顶部那一行里找。最多选 {max} 个；一个都不选时工具栏保持原样。",
      empty: "还没有固定任何东西。请先打开 Collections，在那里固定一个集合或订阅源 —— 这个列表提供的就是你固定过的。",
      unavailable: "固定列表不可用（{error}），所以这里没有东西可以提供。工具栏会继续显示它原本显示的内容；等列表恢复后再打开这里。",
      full: "上限是 {max} 个。清掉一个腾出位置 —— 超过几个之后，它们就会把工具栏本来承载的东西挤出去。",
    },

    gridHeader: {
      intro: "网格上方那条栏一眼能告诉你什么，就在它已经带着的 Claude 和 Codex 用量窗口旁边。",
      loadAverage: "显示这台机器的 load average",
      loadAverageTitle: "Load average",
      loadAverageHint:
        "跑着你的会话的那台机器的负载，按核数的百分比表示 —— 100% 意味着每个核都有排队的活，这时再起一个智能体会让已经在跑的变慢。100% 转琥珀色，200% 转红色。不保留 load average 的主机（Windows）无论如何都不显示。",
    },

    waitingRows: {
      intro:
        "在放大单元格旁边的列表里，智能体{waiting}的行 —— 权限确认、一个问题 —— 会带琥珀色圆环并闪烁。只是{finished}的行是绿色且静止的。关掉它会保留两种颜色、只停掉动作；当你的系统要求减弱动效时，这些行本来就不闪。",
      waiting: "在等你",
      finished: "结束了",
      blink: "让在等我的行闪烁",
      linesTitle: "每行的行数",
      linesHint: "每一行在截断之前显示多少。调高是拿屏幕上能放下多少个会话，去换在原地读完一个长的。",
      fields: {
        summary: "摘要",
        prompt: "你的输入",
        response: "最近一次回复",
      },
      steppers: {
        summary: "摘要的行数",
        prompt: "你的输入的行数",
        response: "最近一次回复的行数",
      },
    },

    cost: {
      intro:
        "根据{pricing}（输入、输出和缓存 token）估算的这个项目的花费 —— 实际账单可能不同，固定套餐（Max）的用量也不会体现。Today / Month 汇总的是这个项目的会话。",
      pricing: "公开的分模型价格",
      group: "预估费用",
      groupTitle: "根据公开的分模型价格估算；实际账单可能不同。",
      session: "本次会话",
      today: "今天",
      month: "本月",
      failed: "读不到费用估算。",
      unpriced: "有些轮次用的模型没有已知价格，已从这些估算中排除。",
    },

    quit: {
      description:
        "停止这台机器上运行的 MulmoTerminal 服务器。关掉这个标签页并不会停掉它 —— 服务器还在跑，而这里就是不用回到当初启动它的那个终端也能停掉它的办法。",
      // Message-function form, which skips vue-i18n's message compiler: the literal `@` in
      // `mulmoterminal@latest` would otherwise be read as a linked-message reference, the compiler
      // throws, and the whole section renders as nothing.
      restartHint: () => "要再次启动，请在终端里运行 `npx mulmoterminal@latest`。",
      button: "退出 MulmoTerminal",
      confirmBody: "服务器会停止，这个页面将无法工作。网格上的每一个终端都会从屏幕上消失。",
      sessionsNote: "和按 Ctrl+C 一样：装了 tmux 的话，智能体的会话会继续跑，下次会出现在「重启后仍存活的会话」里；没装的话，它们会随服务器一起结束。",
      confirmButton: "退出",
      cancel: "取消",
      stopping: "正在停止…",
      failed: "没能停止服务器。",
      stoppedTitle: "MulmoTerminal 已停止",
      stoppedBody: "你可以关闭这个标签页了。",
    },

    language: {
      intro: "这个应用自己的按钮和标签所用的语言。像主题一样按浏览器保存 —— 手机和电脑可以各用各的。它不会影响你的智能体写什么，也不会影响终端里显示什么。",
      picker: "这个应用的语言",
      auto: "跟随浏览器的语言",
      autoResolved: "你的浏览器要的是 {locale}，所以这里按 {label} 显示。",
      partial: "目前翻译过的是设置界面，以及网格上的状态词。应用的其余部分仍然是英文。",
    },
  },

  // 网格和名单上常驻的状态词（#2182）—— 停留在屏幕上时间最长的字符串。
  //
  // 组件一律通过 `Record<状态, 键>` 来取，而不是用状态名拼出键。这正是关键所在：给
  // `AttentionStatus` / `WorkPhase` / `PrPhase` 增加取值时，必须在此处写上名称，否则无法通过
  // 编译（#1894）。
  status: {
    attention: {
      working: "运行中",
      blocked: "等待输入",
      done: "完成",
      idle: "空闲",
    },
    work: {
      planning: "规划中",
      implementing: "编辑中",
    },
    cell: {
      blocked: "需要输入",
      done: "完成 — 待查看",
      working: "运行中…",
      idle: "空闲",
    },
    cellMissedNotify: "{label}（提示音未能播放，可能已错过）",

    // `label` 保留 GitHub 自身的用词：PR 页面就用这些词，徽章也没有放下译文的宽度，而让徽章能与
    // GitHub 对上本来就是它的用途。`title` / `state` 是句子，予以翻译。`title` 独立使用，
    // `state` 用于已经点名 PR 的位置，混用会得到 `PR #2689 · PR — CI running`（#1235）。
    pr: {
      draft: { label: "draft", title: "草稿 PR", state: "草稿" },
      "ci-failing": { label: "CI fail", title: "PR — CI 失败", state: "CI 失败" },
      "changes-requested": { label: "changes", title: "PR — 请求修改", state: "请求修改" },
      "ci-running": { label: "CI…", title: "PR — CI 运行中", state: "CI 运行中" },
      ready: { label: "ready", title: "可合并的 PR", state: "可合并" },
      merged: { label: "merged", title: "PR 已合并", state: "已合并" },
      closed: { label: "closed", title: "PR 已关闭", state: "已关闭" },
    },
  },

  issueStart: {
    agentLabel: "用于开始 Issue",
    accountLabel: "账户",
    defaultLogin: "默认登录",
    notInstalled: "{agent}（未安装）",
    runsAtOnce: "{agent} 启动后会立即执行 Issue 正文。任何能编写该 Issue 的人都可以左右它的行为。",
    runsAtOnceAutoApproved: "{agent} 启动后会立即执行 Issue 正文，并自动批准其工具的使用。任何能编写该 Issue 的人都可以左右它的行为。",
  },

  launch: {
    agentUnavailable: {
      missing: "此计算机上未安装 {agent}，因此无法在此启动。",
      noSuchPath: "{agent} 的命令覆盖设置指向的文件不存在，因此无法启动。",
      notExecutable: "已找到 {agent} 的命令，但无法运行。",
      installGuide: "安装指南",
      restartNote: "处理完成后，请重新启动 MulmoTerminal。",
    },
  },

  // 双键快捷键等待第二个键时显示的提示（#2265）。
  prefixKeys: {
    waiting: "{key} 之后按：",
    cancel: "按 Esc 取消",
  },
  terminal: {
    copyMode: {
      message: "正在查看历史 — 输入不会发送到终端。按 q 返回。",
      exit: "返回输入",
    },
  },
};
