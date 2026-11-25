export const transcriptPaneZhTW = {
  transcriptPane: {
    title: "對話",
    loadingOlder: "正在載入較早的對話…",
    scrollOlder: "向上捲動以查看較早的訊息。",
    cutHere: "…此處省略",
    speakers: { agent: "代理程式", you: "你", tools: "工具", unreadable: "無法讀取的區塊" },
    empty: {
      failed: "無法讀取此工作階段的對話。",
      notStarted: "此儲存格尚未開始工作階段。",
      loading: "正在載入…",
      cleared: "此對話已透過 /clear 結束。下一個提示會開始新的對話。",
      tooLarge: "此記錄太大，無法找到對話回合。",
      notSupported: "此代理程式將對話儲存在此窗格尚不能讀取的位置。",
      none: "此工作階段的記錄中還沒有內容。",
    },
    head: {
      failed: "無法讀取此訊息之前的對話。",
      tooLarge: "較早的訊息太大，無法讀取。",
      cleared: "較早的對話已透過 /clear 結束。",
      start: "這是此對話的開始。",
      none: "無法讀取較早的訊息。",
    },
  },
} as const;
