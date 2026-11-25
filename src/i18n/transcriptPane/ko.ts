export const transcriptPaneKo = {
  transcriptPane: {
    title: "대화",
    loadingOlder: "이전 대화 불러오는 중…",
    scrollOlder: "위로 스크롤하면 이전 대화를 볼 수 있습니다.",
    cutHere: "…여기서 잘림",
    speakers: { agent: "에이전트", you: "나", tools: "도구", unreadable: "읽을 수 없는 블록" },
    empty: {
      failed: "이 세션의 대화를 읽지 못했습니다.",
      notStarted: "이 셀은 아직 세션을 시작하지 않았습니다.",
      loading: "불러오는 중…",
      cleared: "이 대화는 /clear로 종료되었습니다. 다음 프롬프트에서 새 대화가 시작됩니다.",
      tooLarge: "이 트랜스크립트가 너무 커서 대화를 찾을 수 없습니다.",
      notSupported: "이 에이전트의 대화는 아직 이 창에서 읽을 수 없는 위치에 있습니다.",
      none: "이 세션의 트랜스크립트에는 아직 내용이 없습니다.",
    },
    head: {
      failed: "이 부분보다 이전의 대화를 읽지 못했습니다.",
      tooLarge: "이전 대화가 너무 커서 읽을 수 없습니다.",
      cleared: "이전 대화는 /clear로 종료되었습니다.",
      start: "이 대화의 시작입니다.",
      none: "이전 대화를 읽을 수 없습니다.",
    },
  },
} as const;
