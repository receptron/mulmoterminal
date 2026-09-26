import type { Messages } from "./messages";

// 한국어. `Messages`는 en.ts의 모양 그대로라서 키를 하나라도 빠뜨리면 컴파일이 실패한다 ——
// 실행 중에 조용히 영어로 되돌아가 아무도 눈치채지 못하는 상태는 생기지 않는다.
//
// 영어로 두는 말이 있다. 제품 이름, config.json의 키 이름, skill의 이름은 문서와 일대일로
// 대응하므로, 옮기면 독자가 무엇을 검색해야 할지 알 수 없게 된다.
export const ko: Messages = {
  settings: {
    title: "설정",
    close: "닫기",
    closeAria: "설정 닫기",
    sectionsNav: "설정 항목",
    sectionPicker: "설정 항목",

    groups: {
      appearance: "화면",
      projects: "프로젝트",
      launch: "헤더와 실행",
      input: "입력",
      models: "모델과 서버",
      notifications: "알림",
      integrations: "연동",
      sessions: "세션",
      help: "도움말",
    },

    tabs: {
      language: "언어",
      theme: "테마",
      font: "터미널 글꼴",
      fontSize: "터미널 글자 크기",
      scroll: "터미널 스크롤 속도",
      waitingRows: "기다리는 행",
      gridHeader: "그리드 헤더 표시",
      toolbarPins: "툴바 고정",
      dirAppearance: "디렉터리 모양",
      dirSettings: "디렉터리 설정",
      launchers: "실행 명령",
      headerChrome: "헤더 버튼과 칩",
      terminalKeys: "터미널 키",
      shortcuts: "키보드 단축키",
      voice: "음성 입력",
      models: "모델과 백엔드",
      mcp: "MCP 서버",
      sounds: "알림음",
      push: "Web Push 알림",
      quickCommands: "휴대폰 상용구",
      github: "GitHub와 GitLab",
      prRepos: "풀 리퀘스트 저장소",
      google: "Google 계정",
      sessions: "세션과 백그라운드 작업",
      surviving: "재시작에서 살아남은 세션",
      cost: "비용(추정)",
      quit: "MulmoTerminal 종료",
      help: "도움말과 사용자 가이드",
    },

    terminalKeys: {
      copyOnSelect: "선택이 끝나는 즉시 복사하기",
      copyOnSelectTitle: "선택하면 복사",
      copyOnSelectHint: "마우스 선택이 끝나는 순간, 키를 누르지 않아도 클립보드에 들어갑니다. 그냥 강조만 하려던 때에도 클립보드를 덮어쓰는 유일한 설정입니다.",
      questionPane: "질문에 옆 패널에서 답하기",
      questionPaneTitle: "질문 패널",
      questionPaneHint:
        "세션이 무언가를 물어오면, 그 선택지를 터미널 옆 패널에 버튼으로 내놓습니다. 하나를 고르면 터미널에 이미 떠 있는 대화상자의 키를 대신 눌러 주므로, 여전히 터미널 쪽에서 답해도 됩니다.",
      enterTitle: "Enter 키",
      enterHint:
        "터미널 안에서 도는 Claude Code가 어떤 바이트를 「전송」으로 읽을지. 쓰고 있는 Claude 설정에 맞추세요. Claude 세션에만 적용되며 shell의 Enter는 그대로입니다.",
      enterField: "Claude 세션에서 전송이 되는 바이트",
      modes: {
        cr: "Enter로 전송, Option/Alt+Enter로 줄바꿈(기본값)",
        "esc-cr": "Option/Alt+Enter로 전송, Enter로 줄바꿈",
      },
    },

    shortcuts: {
      intro:
        "읽기 전용이며, 할당 여부와 상관없이 전부 {keymapKey} 아래에 나열됩니다. 할당할 수 있는 것은 두 가지 —— MulmoTerminal의 동작(확대, 기다리는 에이전트로 이동, 복사 / 붙여넣기), 그리고 터미널로 보내는 키 시퀀스(Mac에서 Cmd+←로 줄 맨 앞으로). 할당한 키는 터미널 안의 프로그램에 더 이상 닿지 않으므로, 아래 버튼으로 설정하세요 —— 에이전트가 기존 할당과 브라우저·Mac이 각자 만들어 내는 함정을 먼저 대조한 뒤에 씁니다. 레퍼런스는 {guide}에 있습니다.",
      guide: "가이드",
      actions: {
        zoomToggle: "터미널 확대 / 되돌리기",
        zoomNext: "다음 터미널 확대",
        zoomPrev: "이전 터미널 확대",
        focusNext: "다음 터미널로 커서 옮기기(그리드 보기에서만)",
        focusPrev: "이전 터미널로 커서 옮기기(그리드 보기에서만)",
        nextAttention: "나를 기다리는 터미널로 이동",
        terminalNew: "실행 패널 열기",
        terminalNewHere: "이 터미널의 디렉터리에서 실행 패널 열기",
        terminalNewAdjacent: "이 터미널의 디렉터리에서 곧바로 shell 열기",
        terminalClose: "이 터미널 닫기",
        terminalRestart: "이 터미널의 에이전트 다시 시작",
        filesFind: "이 터미널 옆에서 파일 이름으로 찾아 열기",
        filesSearch: "이 터미널 옆에서 파일 내용 검색",
        copy: "터미널에서 선택한 내용 복사",
        paste: "터미널에 붙여넣기",
      },
      list: "키보드 단축키",
      notSet: "설정 안 됨",
      sendRow: "{key}를 터미널로 보내기",
      sendNone: "터미널로 키 보내기",
      setUp: "단축키 설정하기…",
    },

    surviving: {
      intro:
        "터미널은 서버보다 오래 살아남으므로, 여기 있는 것들은 이전 실행에서부터 계속 돌고 있는 것입니다. {whatever} 목록에 나옵니다 —— 이제 열지 않는 디렉터리의 것도, 여기 말고는 어느 목록에도 나오지 않는 shell도 포함해서요. 한 줄을 멈추면 그 세션만 끝납니다. 대화 기록이 남아 있는 것은 나중에 그 디렉터리에서 다시 이어갈 수 있습니다.",
      whatever: "어느 디렉터리의 것이든",
      shellOrUnknown: "shell 또는 알 수 없음",
      unknownAgentTitle: "이 키로 기록된 에이전트 대화가 없습니다 —— shell이거나, 실행 명령이거나, 이 서버가 되짚어 갈 수 없는 에이전트입니다",
      lastActive: "마지막 활동 {when}",
      loading: "살아남은 세션을 읽는 중…",
      failed: "읽을 수 없습니다 —— tmux가 돌고 있지 않을 수 있습니다.",
      unknownDir: "디렉터리 알 수 없음",
      unknownDirTitle: "이 서버는 그것이 어디서 도는지 한 번도 본 적이 없습니다",
      notResumable: "이어갈 수 없음",
      notResumableTitle: "이것을 이어갈 만한 것이 디스크에 없습니다",
      doomed: "자동 종료 대상",
      doomedTitle: "아무것도 쓰고 있지 않고 {days}일 동안 출력도 없습니다 —— 다음 스윕이 종료합니다",
      open: "● 사용 중",
      openTitle: "터미널이 붙잡고 있습니다 —— 그쪽에서 닫아 주세요",
      stopTitle: "이 세션 멈추기",
      stopAria: "{dir}의 세션 멈추기",
      stopAriaUnknown: "알 수 없는 디렉터리",
      none: "없음 —— 이전 서버에서부터 돌고 있는 것이 없습니다.",
      reapStepper: "세션을 종료하기까지의 유휴 일수",
      reapUnit: " 일",
      sweepStepper: "스윕을 반복하는 간격",
      sweepUnit: " 시간",
      sweepHint: "저장된 값: {hours}시간마다 반복.",
      sweepOffTitle: "저장된 값: 서버 시작 때만.",
      sweepOffHint: "켜 둔 채로 있는 서버는 그 뒤로 다시 보지 않습니다 —— 반복시키려면 이 값을 올리세요.",
      sweepDisabledHint: "위에서 스윕 자체가 꺼져 있으므로 반복할 것이 없습니다.",
      sweepRunning: "이 서버는 {hours}시간마다 스윕을 반복하고 있습니다.",
      sweepRunningOff: "이 서버는 시작할 때 한 번만 스윕하며 반복하지 않습니다.",
      sweepPending: "위에서 저장한 주기는 다음 시작부터 적용됩니다.",
      sweepNote: "이 간격은 서버가 시작할 때 읽으므로, 여기서 바꾼 값은 다음 시작부터 적용됩니다.",
      neverTitle: "자동으로 종료하지 않습니다.",
      neverHint: "여기서 멈추거나, 붙잡고 있는 터미널에서 끝낼 때까지 남아 있습니다.",
      reapHint: "아무것도 쓰고 있지 않고 —— 붙은 사람도 없고 이만큼 출력도 없는 —— 세션은 {ended}. 대화는 남습니다. 0으로 두면 자동으로 종료하지 않습니다.",
      reapEnded: "다음 스윕에서 종료됩니다",
    },

    sounds: {
      intro:
        "어느 순간에 소리를 낼지, 그리고 각각 무엇을 울릴지. 알림을 소음으로 바꾸는 것은 에이전트를 한꺼번에 여러 개 돌리는 일입니다 —— 필요 없는 것은 체크를 해제하세요. 툴바의 스피커 버튼으로 한 번에 전부 음소거할 수 있습니다.",
      beepAria: "세션이 {kind} 상태일 때 소리 내기",
      soundFor: "{label} 소리",
      playFor: "{label} 소리 재생",
      default: "기본",
      defaultTitle: "기본",
      defaultHint: "아래에서 지정한 파일을 재생하고, 비어 있으면 내장 차임을 재생합니다. 프리셋은 한 번만 받아 이 기기에 보관하므로 오프라인에서도 동작합니다.",
      fileField: "사용자 알림음 파일",
      browse: "찾아보기…",
      useChime: "차임으로 되돌리기",
      useChimeTitle: "내장 차임 사용",
      outro:
        "여기서 정하는 것은 모든 세션에 공통인 소리입니다. skill을 쓰면 한 프로젝트에만 다른 소리를 주고, 어느 순간을 휴대폰으로 푸시할지 고르고, 그중 무엇이 당신을 깨우는 것인지까지 가려낼 수 있습니다.",
      configure: "알림 설정하기…",
      kinds: {
        finished: "턴이 끝남",
        waiting: "당신을 기다리는 중",
        "command-done": "명령이 끝남",
        "command-failed": "명령이 실패함",
        "session-exited": "세션이 끝남",
        "worker-failed": "백그라운드 작업이 실패함",
        "pr-ci-failed": "PR의 CI가 실패함",
      },
      help: {
        finished: "에이전트가 답했고 그 출력을 아직 읽지 않음",
        waiting: "권한 확인이나 질문으로 멈춤",
        "command-done": "Run 셀의 명령이 정상 종료함",
        "command-failed": "Run 셀의 명령이 오류로 끝났거나 아예 시작되지 않음",
        "session-exited": "세션의 터미널이 끝남 —— 직접 셀을 닫은 경우도 포함",
        "worker-failed": "백그라운드 작업이 끝마치지 못한 채 종료됨 —— 화면에 터미널이 없으므로 이것 말고는 알려 주는 것이 없습니다",
        "pr-ci-failed": "어느 디렉터리의 PR이 빨개짐. 폴링하는 것이 roster이므로 roster가 화면에 떠 있을 때만 보입니다",
      },
    },

    guide: {
      prompt: "MulmoTerminal을 어떻게 쓰는지 모르겠다면 가이드를 보세요 ——",
    },

    push: {
      intro:
        "백그라운드 작업이 끝나면 등록해 둔 기기로 푸시를 보냅니다. {remoteHost} 연결이 필요합니다 —— 알림 인증이 그 로그인에서 나오므로, 연결되어 있는 동안에만 보내집니다.",
      remoteHost: "RemoteHost",
      master: "내 기기로 Web Push 보내기",
      masterLabel: "내 기기에 알리기",
      whichMoments: "푸시할 만한 순간:",
      kindAria: "세션이 {kind} 상태일 때 푸시",
      kinds: {
        finished: "턴이 끝남",
        waiting: "당신을 기다리는 중",
      },
      help: {
        finished: "에이전트가 답했고 그 출력을 아직 읽지 않음",
        waiting: "권한 확인이나 질문으로 멈춤. 물어볼 때마다 한 번씩 울리므로, 자주 묻는 작업은 자주 푸시합니다",
      },
    },

    github: {
      issueComments: "셀이 맡은 issue에 댓글 달기",
      issueCommentsTitle: "issue에 착수했다고 알리기",
      issueCommentsHint:
        "댓글은 하나뿐이며, 착수할 때 올리고 PR이 열릴 때와 병합될 때 수정합니다. 작업 디렉터리(경로가 아니라 폴더 이름만)를 적으므로, 터미널 둘이 같은 issue를 두 번 시작하지 않습니다. {gh}(또는 {glab}) 로그인이 필요합니다.",
      prFooter: "만든 PR 끝에 클론 이름 적기",
      prFooterHint: "본문 맨 아래에 {line} 한 줄을 붙입니다. 나란히 둔 여러 클론 중 어느 것에서 나왔는지 PR이 말해 줍니다.",
      gitlabTitle: "자체 호스팅 GitLab",
      gitlabHint:
        "URL만 봐서는 그 호스트가 어떤 forge인지 알 수 없으므로 여기서 선언하면 {glab}으로 저장소를 읽습니다. {authCommand}가 필요합니다. 다음 서버 시작부터 적용됩니다.",
      gitlabField: "자체 호스팅 GitLab 호스트 추가",
    },

    sessions: {
      summary: "답변을 마무리 요약으로 끝내기",
      summaryHint:
        "무엇을 부탁받았고, 무엇을 해냈고, 무엇을 못 했는지를 규칙으로 씁니다. 그리드를 위해 있는 기능입니다 —— 나중에 셀로 돌아왔을 때, 이것이 없으면 세션 전체를 스크롤해야만 되찾을 수 있습니다. 지금부터 시작하는 세션에 적용되며, 디렉터리 자신의 {dirFile}이 이것보다 우선합니다.",
      digest: "결정 사항 요약 남기기",
      digestTitle: "이 프로젝트에서 정한 것들의 요약 남기기",
      digestHint: "에이전트가 프로젝트에서 이미 정해진 것을 다시 묻기 전에 읽을 수 있는 Markdown 파일입니다. {dir} 아래에 씁니다.",
      worklog: "개발 작업 로그를 주기적으로 남기기",
      worklogHint: "저장해 둔 작업 디렉터리 전체의 최근 작업을 주 단위 wiki 페이지로 정리합니다. 실행할 때마다 LLM 세션을 띄우므로 토큰을 씁니다.",
      worklogInterval: "실행 주기:",
      worklogStepper: "개발 작업 로그 주기",
      systemTasks: "내장 예약 작업",
      systemTasksHint: "둘 다 한 시간마다 돌고, 끄지 않는 한 켜져 있습니다. 하나를 끄면 서버가 다음에 시작할 때 반영됩니다.",
      feedRefresh: "컬렉션과 피드 새로고침",
      feedRefreshHint:
        "RSS/JSON 피드를 받아오고 skill 기반 컬렉션 업데이트를 내보냅니다. 워크스페이스와 저장해 둔 모든 프로젝트 디렉터리가 대상입니다. 피드를 하나도 등록하지 않았다면 아무것도 하지 않습니다.",
      calendarSync: "Google 캘린더 동기화",
      calendarSyncHint: "Google 캘린더를 선언한 컬렉션에 변경된 일정을 가져옵니다. 계정을 연결하기 전에는 아무것도 하지 않습니다.",
    },

    launchers: {
      intro:
        "그리드 셀에서 돌릴 수 있는 대화형 명령이라면 무엇이든 —— 개발 서버, REPL, git UI, 모델 브리지. 셀의 디렉터리에서 상주 터미널로, 쓴 그대로 실행됩니다. 예: {labelExample} → {commandExample}.",
      notAnAgent: "에이전트를 띄우려면 빈 셀에서 Agent Picker를 쓰세요 —— 실행 명령으로는 세션에 필요한 것이 아무것도 붙지 않습니다.",
      labelField: "실행 항목 라벨",
      labelPlaceholder: "라벨",
      commandField: "실행 명령",
      commandPlaceholder: "명령(예: $SHELL)",
    },

    quickCommands: {
      intro:
        "자주 보내는 문구를 휴대폰 터미널 화면에 칩으로 내놓습니다. 누르면 입력란에 들어갈 뿐, 전송을 누르기 전에는 보내지지 않습니다. 라벨이 칩의 얼굴이므로 짧게 쓰세요. 예: {labelExample} → {textExample}. 하나도 체크하지 않으면 모든 종류에 나오고, 어울리는 것만 체크할 수도 있습니다 —— {gitStatus}는 shell의 것이지 Claude의 것이 아닙니다.",
      labelField: "상용구 라벨",
      labelPlaceholder: "라벨",
      textField: "상용구 내용",
      textPlaceholder: "입력란에 넣을 문자열(예: PR作って)",
      offerTo: "내놓을 대상:",
      offerToAgent: "{agent} 세션에 내놓기",
      offerToNone: "(아무것도 체크 안 함 = 모든 종류)",
    },

    mcp: {
      intro:
        "{singleView}의 Claude 세션이 불러오는 HTTP MCP 서버입니다(내장 GUI 도구에 더해서). {idKey}가 서버 이름, {urlKey}가 그 streamable-HTTP 엔드포인트입니다. Docker 샌드박스에서는 {localhost} URL이 자동으로 {dockerHost}를 거칩니다. 다음 Claude 세션부터 적용됩니다.",
      singleView: "단일 보기",
      idField: "MCP 서버 id",
      idPlaceholder: "id(예: weather)",
      urlField: "MCP 서버 URL",
      urlPlaceholder: "https://… 또는 http://localhost:PORT/mcp",
    },

    headerChrome: {
      intro:
        "터미널 헤더에 늘어서는 동작 버튼과 표시 칩입니다. 전역으로는 {buttons}과 {chips}이 있고, 프로젝트는 자기 {dirFile}에서 id 단위로 더하거나 바꿀 수 있으므로, 어떤 터미널이 실제로 보여 주는 것은 둘을 합친 결과입니다.",
      builtInButtons: "내장 버튼",
      noButtons: "버튼 없음(모두 제거됨)",
      someButtons: "버튼 {count}개",
      builtInChips: "내장 칩",
      noChips: "칩 없음(모두 제거됨)",
      someChips: "칩 {count}개",
      setUp: "헤더 버튼 설정하기…",
    },

    models: {
      intro:
        "세션을 돌릴 수 있는 Anthropic 호환 백엔드입니다({configFile}의 {providersKey}에서). 디렉터리마다 자기 {dirFile}의 {providerKey} / {modelKey}로 하나를 고정할 수 있습니다. 키는 환경 변수에 두며 설정 파일에는 절대 쓰지 않습니다.",
      modelCount: "모델 {count}개",
      keyIn: "키는 {env}",
      notReady: "쓸 수 없음",
      notInPicker: "선택기에 없음",
      ready: "쓸 수 있음",
      noProviders: "설정되지 않음 —— 세션은 내장 기본값으로 돕니다.",
      customTitle: "나만의 방식으로 Claude Code 띄우기",
      customIntro:
        "—— 내장 에이전트와 Shell 옆에 나란히 Agent Picker에 나옵니다. 실행 명령이 아닙니다: Claude Code 자신의 인자가 명령 뒤에 붙으므로, 그 셀도 다른 Claude 세션과 똑같이 이어가고, 비용을 보고하고, GUI 도구에 닿습니다.",
      noCustomAgents: "설정되지 않음.",
      accountsTitle: "두 번째 구독",
      accountsIntro:
        "— Claude Code 또는 Codex의 다른 로그인을 각자의 설정 디렉터리로 사용합니다. 새 셀은 실행 화면에서 계정을 골라 시작할 수 있고, 그 셀의 헤더에 계정 이름이 표시됩니다. 세션은 시작한 계정에서 계속 실행됩니다.",
      noAccounts: "설정되지 않음 — 모든 셀이 기본 로그인으로 실행됩니다.",
      addBackend: "백엔드 추가하기…",
    },

    common: {
      add: "추가",
      remove: "{name} 제거",
    },

    dirAppearance: {
      intro:
        "{skill} skill을 띄우면 디렉터리의 모양과 순서 —— 이름 배지, 아이콘, 색, 터미널 팔레트, 그리드에서의 위치 —— 를 정할 수 있습니다. 실제로 여는 디렉터리에서 출발해 이미 가진 설정을 읽고, 아직 아무것도 없는 것에도 같은 방식을 따릅니다.",
      configure: "모양 설정하기…",
      favicon: "프로젝트 자신의 favicon 쓰기",
      faviconHint:
        "{iconKey}를 정하지 않은 디렉터리는 그 저장소가 이미 가지고 있는 이미지({svg}, {png}, web manifest)를 보여 줍니다. 원하지 않는 프로젝트는 자기 {dirFile}에 {iconFalse}라고 적으며, 이 설정은 그것을 덮어쓰지 않습니다.",
    },

    dirSettings: {
      intro:
        "각 디렉터리의 {dirFile}이 실제로 무엇을 하고 있는지. 한 줄을 펼치면 효력이 있는 값과, 앱이 버렸거나 아예 알지 못하는 키가 보입니다 —— 이걸 보기 전까지는 한 번도 적용되지 않은 설정과 애초에 쓴 적 없는 설정이 똑같아 보입니다.",
      outro: "여기 나오는 것은 무엇이 잘못됐는지입니다. skill은 같은 것을 읽고 이유를 설명한 뒤, 고치거나 그 키를 맡은 skill로 안내합니다.",
      explain: "내 설정 설명 듣기…",
    },

    google: {
      intro:
        "Google 계정을 연결하면 {tool} 도구와 휴대폰에서 {calendar} 일정을 읽고 만들 수 있습니다. 로그인은 새 탭에서 열려 {thisMachine}에서 끝나므로 여기 브라우저를 쓰세요. 원격 연결이라면 대신 {cli}를 실행하세요. 이 연결은 MulmoClaude와 공유됩니다.",
      calendar: "캘린더",
      thisMachine: "이 기기",
      checking: "확인 중…",
      pending: "브라우저에서 동의하기를 기다리는 중…",
      linked: "연결됨",
      notLinked: "연결 안 됨",
      signIn: "Google로 로그인",
      unlink: "연결 해제",
      confirmUnlink: "이 Google 계정의 연결을 해제할까요? 다시 로그인하기 전까지 MulmoTerminal은 캘린더에 접근할 수 없습니다.",
      secretMissing:
        "~/.secrets에서 OAuth 클라이언트 시크릿을 찾지 못했습니다. 데스크톱 클라이언트의 client_secret_*.json을 거기에 두면 로그인할 수 있습니다. 쓸 수 있다면 GCP 설정이 필요 없는 브로커 연결을 써도 됩니다.",
      secretAmbiguous: "~/.secrets에 client_secret_*.json이 여러 개 있습니다 —— 정확히 하나만 남기세요.",
    },

    prRepos: {
      intro: "저장소를 가로지르는 {view} 보기가 열린 PR을 나열할 저장소입니다. 당신의 {gh} 로그인을 씁니다. 형식: {format}.",
      view: "풀 리퀘스트",
      field: "저장소 추가(owner/repo)",
    },

    skillLaunch: {
      hint: "이 일은 에이전트가 대신해 줍니다 —— 몇 가지를 묻고 설정 파일을 직접 고칩니다.",
    },

    skillConfirm: {
      title: "에이전트에게 설정을 맡길까요?",
      what: "그리드에 새 터미널이 하나 열리고 거기서 {agent}가 시작합니다 —— 몇 가지를 묻고 설정 파일을 직접 고칩니다.",
      howToStop: "그만두려면 그 터미널을 닫기 버튼으로 닫으세요 —— 세션은 거기서 끝납니다. 설정은 언제든 툴바에서 다시 열 수 있습니다.",
      launchWith: "무엇으로 띄울지",
      launchWithAria: "이 skill을 띄울 에이전트 —— 컬렉션 채팅이 쓰는 것과 같은 선택",
      cancel: "취소",
      start: "시작",
    },

    version: {
      label: "버전",
      commit: "커밋 {sha}",
    },

    voice: {
      intro:
        "받아쓰기를 할 때 말하는 언어입니다. 마이크가 기대하지 않는 언어로 말하면 기대한 언어로 {translated} 돌아옵니다 —— 그러니 브라우저의 언어로 두지 말고 실제로 말하는 언어를 고르세요.",
      translated: "번역되어",
      picker: "음성 입력 언어",
      browserLanguage: "브라우저의 언어에 맞추기",
      detect: "말한 내용으로 판단하기",
      always: "항상 이 언어",
    },

    stepper: {
      decrease: "{label} 줄이기",
      increase: "{label} 늘리기",
    },

    theme: {
      missing: "선택한 테마 {id}이(가) 정의되어 있지 않습니다. {configFile}의 {themesKey}에 추가하거나 아래에서 하나 고르세요. 그때까지 선택은 유지됩니다.",
      intro:
        "있는 것 중에서 고릅니다. 직접 만든 배색은 {configFile}의 {themesKey}에 두면 내장된 넷 옆에 나옵니다 —— skill은 팔레트나 사진, 브랜드 색에서 하나를 써 내고 대비까지 확인합니다.",
      group: "테마",
      create: "테마 만들기…",
    },

    font: {
      intro:
        "모든 터미널이 그릴 때 쓰는 CSS font-family 스택입니다. CJK 글자가 이상해 보일 때 손대세요 —— 맨 앞 글꼴에 일본어 글리프가 없으면 글자마다 대체가 일어나 줄이 맞지 않게 됩니다. 비워 두면 내장 스택을 씁니다. 디렉터리마다 자기 {dirFile}의 {key}로 고정할 수 있습니다.",
      field: "터미널 font-family 스택",
      apply: "적용",
      invalid:
        "글꼴 스택이 아닙니다. 이름은 쉼표로 나누세요 —— {example}. CSS 구문 문자와 짝이 맞지 않는 따옴표는 거부합니다. 하나만 잘못돼도 선언 전체가 무효가 되기 때문입니다.",
      hint: "적용되는 순간 열려 있는 터미널이 다시 맞춰집니다 —— 글꼴이 다르면 글자 전진 폭도 달라지고, 그대로 두면 그리드가 캔버스와 어긋나기 때문입니다. 총칭 글꼴 계열을 적지 않았다면 {mono}가 뒤에 붙으므로, 아무것도 맞지 않는 스택이어도 고정폭으로 되돌아갑니다.",
    },

    fontSize: {
      stepper: "터미널 글자 크기",
      hint: "이 브라우저의 모든 터미널에 적용됩니다. 디렉터리마다 자기 {dirFile}의 {key}로 고정할 수 있습니다.",
    },

    scroll: {
      stepper: "터미널 스크롤 속도",
      hint: "휠 한 칸, 또는 트랙패드 한 번의 스와이프로 터미널이 얼마나 움직일지 —— 1×가 기본값입니다. Mac 트랙패드의 두 손가락 스크롤로 읽던 자리를 지나쳐 버린다면 낮추세요. 브라우저별 설정이며, shell의 스크롤백에도 Claude Code 같은 전체 화면 앱에도 적용됩니다.",
      returnLabel: "보낼 때 최신 출력으로 돌아가기",
      returnHint:
        "Enter(또는 전송 버튼)를 누르면 위로 스크롤해 둔 터미널이 보통 터미널처럼 맨 아래로 돌아갑니다. shell은 원래 이렇게 동작하지만, Claude Code 같은 전체 화면 에이전트는 스크롤 위치를 스스로 들고 있어서 그러지 않습니다 —— 이 설정이 방금 한 그 스크롤만 정확히 되감아 줍니다. 턴이 도는 동안에도 읽던 자리에 머물고 싶다면 끄세요.",
    },

    toolbarPins: {
      intro:
        "고정해 둔 컬렉션과 피드를 툴바 자체에, Grid와 Collections 옆에 둘 수 있습니다 —— Collections를 먼저 열고 맨 위 줄에서 찾는 대신 한 번에 누릅니다. 최대 {max}개까지 고를 수 있고, 하나도 고르지 않으면 툴바는 그대로입니다.",
      empty: "아직 고정한 것이 없습니다. 먼저 Collections를 열고 컬렉션이나 피드를 고정하세요 —— 이 목록이 내놓는 것은 고정해 둔 것들입니다.",
      unavailable: "고정 목록을 쓸 수 없어({error}) 여기 내놓을 것이 없습니다. 툴바는 이미 보여 주던 것을 그대로 유지합니다. 목록이 돌아오면 다시 열어 주세요.",
      full: "{max}개가 한도입니다. 자리를 만들려면 하나를 비우세요 —— 몇 개를 넘어서면 툴바가 원래 싣고 있던 것을 밀어냅니다.",
    },

    gridHeader: {
      intro: "그리드 위의 막대가 한눈에 무엇을 알려 주는지. 이미 달고 있는 Claude와 Codex 사용량 창 옆입니다.",
      loadAverage: "이 기기의 load average 표시",
      loadAverageTitle: "Load average",
      loadAverageHint:
        "세션을 돌리는 기기의 부하를 코어 수 대비 퍼센트로 보여 줍니다 —— 100%는 모든 코어에 대기 중인 일이 있다는 뜻이고, 여기서 에이전트를 더 띄우면 이미 돌던 것들이 느려집니다. 100%에서 호박색, 200%에서 빨강. load average를 두지 않는 호스트(Windows)에서는 어느 쪽이든 아무것도 나오지 않습니다.",
    },

    waitingRows: {
      intro:
        "확대한 셀 옆 목록에서, 에이전트가 {waiting} 행 —— 권한 확인, 질문 —— 은 호박색 테두리를 달고 깜박입니다. 그냥 {finished} 행은 초록색이고 가만히 있습니다. 이것을 끄면 두 색은 그대로 두고 움직임만 멈춥니다. 시스템이 동작 줄이기를 요청하면 행은 원래 깜박이지 않습니다.",
      waiting: "당신을 기다리는",
      finished: "끝나기만 한",
      blink: "나를 기다리는 행을 깜박이게 하기",
      linesTitle: "행당 줄 수",
      linesHint: "각 행을 어디까지 보여 주고 자를지. 올릴수록 화면에 들어가는 세션 수를 내주고, 긴 것 하나를 그 자리에서 읽게 됩니다.",
      fields: {
        summary: "요약",
        prompt: "당신의 입력",
        response: "마지막 답변",
      },
      steppers: {
        summary: "요약 줄 수",
        prompt: "당신의 입력 줄 수",
        response: "마지막 답변 줄 수",
      },
    },

    cost: {
      intro:
        "{pricing}(입력·출력·캐시 토큰)으로 계산한 이 프로젝트의 추정 지출입니다 —— 실제 청구와 다를 수 있고, 정액 요금제(Max) 사용량은 반영되지 않습니다. Today / Month는 이 프로젝트의 세션을 합산합니다.",
      pricing: "공개된 모델별 가격",
      group: "추정 비용",
      groupTitle: "공개된 모델별 가격에서 추정했습니다. 실제 청구와 다를 수 있습니다.",
      session: "이번 세션",
      today: "오늘",
      month: "이번 달",
      failed: "비용 추정을 불러올 수 없습니다.",
      unpriced: "가격을 알 수 없는 모델을 쓴 턴이 있어 이 추정에서 제외했습니다.",
    },

    quit: {
      description:
        "이 기기에서 돌고 있는 MulmoTerminal 서버를 멈춥니다. 이 탭을 닫아도 멈추지 않습니다 —— 서버는 계속 돌고 있고, 처음 띄운 터미널로 돌아가지 않고 멈추는 방법이 바로 여기입니다.",
      // Message-function form, which skips vue-i18n's message compiler: the literal `@` in
      // `mulmoterminal@latest` would otherwise be read as a linked-message reference, the compiler
      // throws, and the whole section renders as nothing.
      restartHint: () => "다시 띄우려면 터미널에서 `npx mulmoterminal@latest`를 실행하세요.",
      button: "MulmoTerminal 종료",
      confirmBody: "서버가 멈추고 이 페이지는 동작하지 않게 됩니다. 그리드 위의 모든 터미널이 화면에서 사라집니다.",
      sessionsNote:
        "Ctrl+C를 누르는 것과 같습니다: tmux가 깔려 있으면 에이전트 세션은 계속 돌고 다음에 「재시작에서 살아남은 세션」에 나옵니다. 없으면 서버와 함께 끝납니다.",
      confirmButton: "종료",
      cancel: "취소",
      stopping: "멈추는 중…",
      failed: "서버를 멈추지 못했습니다.",
      stoppedTitle: "MulmoTerminal이 멈췄습니다",
      stoppedBody: "이 탭은 닫아도 됩니다.",
    },

    language: {
      intro:
        "이 앱 자신의 버튼과 라벨이 쓰인 언어입니다. 테마처럼 브라우저마다 저장되므로 휴대폰과 PC가 서로 다를 수 있습니다. 에이전트가 쓰는 내용이나 터미널에 보이는 것은 바뀌지 않습니다.",
      picker: "이 앱의 언어",
      auto: "브라우저의 언어에 맞추기",
      autoResolved: "브라우저가 {locale}을(를) 요청하므로 {label}(으)로 표시됩니다.",
      partial: "지금까지 번역된 것은 설정 화면과 그리드에 표시되는 상태 단어입니다. 앱의 나머지는 아직 영어입니다.",
    },
  },

  // 그리드와 로스터에 계속 떠 있는 상태 단어(#2182) — 화면에 가장 오래 남는 문자열이다.
  //
  // 모든 그룹은 컴포넌트에서 `Record<상태, 키>`로 읽는다. 상태 이름으로 키를 조립하지 않는 것이
  // 핵심으로, `AttentionStatus` / `WorkPhase` / `PrPhase`에 값을 추가했을 때 여기에 이름을 적기
  // 전까지 컴파일이 통과하지 않도록 하기 위해서다(#1894).
  status: {
    attention: {
      working: "실행 중",
      blocked: "입력 대기",
      done: "완료",
      idle: "대기",
    },
    work: {
      planning: "계획 중",
      implementing: "편집 중",
    },
    cell: {
      blocked: "입력 필요",
      done: "완료 — 확인",
      working: "실행 중…",
      idle: "대기",
    },
    cellMissedNotify: "{label} (알림음을 재생할 수 없어 놓쳤습니다)",

    // `label`은 GitHub의 용어 그대로 둔다. PR 페이지가 그 단어를 쓰고, 배지에는 번역을 넣을 폭이
    // 없으며, 배지를 GitHub와 맞춰 보는 것이 배지의 역할이기 때문이다. `title` / `state`는 문장이라
    // 번역한다. `title`은 단독으로 쓰는 말, `state`는 이미 PR을 지목한 자리에서 쓰는 말이고, 섞으면
    // `PR #2689 · PR — CI running`이 된다(#1235).
    pr: {
      draft: { label: "draft", title: "초안 PR", state: "초안" },
      "ci-failing": { label: "CI fail", title: "PR — CI 실패", state: "CI 실패" },
      "changes-requested": { label: "changes", title: "PR — 변경 요청", state: "변경 요청" },
      "ci-running": { label: "CI…", title: "PR — CI 실행 중", state: "CI 실행 중" },
      ready: { label: "ready", title: "병합할 수 있는 PR", state: "병합 가능" },
      merged: { label: "merged", title: "PR 병합됨", state: "병합됨" },
      closed: { label: "closed", title: "PR 닫힘", state: "닫힘" },
    },
  },

  issueStart: {
    agentLabel: "Issue 시작에 사용",
    accountLabel: "계정",
    defaultLogin: "기본 로그인",
    notInstalled: "{agent} (설치되지 않음)",
    runsAtOnce: "{agent}은(는) 시작하자마자 Issue 본문을 실행합니다. Issue를 작성할 수 있는 사람은 누구나 그 동작을 좌우할 수 있습니다.",
    runsAtOnceAutoApproved:
      "{agent}은(는) 시작하자마자 Issue 본문을 실행하고 도구 사용도 자동으로 승인합니다. Issue를 작성할 수 있는 사람은 누구나 그 동작을 좌우할 수 있습니다.",
  },

  launch: {
    agentUnavailable: {
      missing: "이 컴퓨터에 {agent}이(가) 설치되어 있지 않아 여기서 시작할 수 없습니다.",
      noSuchPath: "{agent}의 명령 재정의가 가리키는 파일이 없어 시작할 수 없습니다.",
      notExecutable: "{agent}의 명령을 찾았지만 실행할 수 없습니다.",
      installGuide: "설치 가이드",
      restartNote: "조치한 후 MulmoTerminal을 다시 시작하세요.",
    },
  },

  // 2타 단축키가 두 번째 키를 기다리는 동안 보이는 안내 (#2265).
  prefixKeys: {
    waiting: "{key} 다음에 누를 키:",
    cancel: "Esc로 취소",
  },
  terminal: {
    copyMode: {
      message: "기록 보는 중 — 입력이 터미널로 전달되지 않습니다. q를 눌러 돌아갑니다.",
      exit: "입력으로 돌아가기",
    },
  },
};
