export const transcriptPaneZhCN = {
  transcriptPane: {
    title: "对话",
    loadingOlder: "正在加载更早的对话…",
    scrollOlder: "向上滚动以查看更早的消息。",
    cutHere: "…此处省略",
    speakers: { agent: "代理", you: "你", tools: "工具", unreadable: "无法读取的区块" },
    empty: {
      failed: "无法读取此会话的对话。",
      notStarted: "此单元格尚未开始会话。",
      loading: "正在加载…",
      cleared: "此对话已通过 /clear 结束。下一个提示会开始新的对话。",
      tooLarge: "此记录太大，无法找到对话轮次。",
      notSupported: "此代理将对话保存在此面板尚不能读取的位置。",
      none: "此会话的记录中还没有内容。",
    },
    head: {
      failed: "无法读取此消息之前的对话。",
      tooLarge: "更早的消息太大，无法读取。",
      cleared: "更早的对话已通过 /clear 结束。",
      start: "这是此对话的开始。",
      none: "无法读取更早的消息。",
    },
  },
} as const;
