// The token usage screen (#2919).
export const usageViewKo = {
  title: "토큰 사용량",
  region: "토큰 사용량",
  close: "토큰 사용량 닫기",
  intro: "tokenRotation에 등록한 각 구독의 남은 양입니다. 새 세션은 주간 창의 남은 양을 초기화까지의 시간으로 나눈 값이 가장 큰 구독에서 시작합니다.",
  column: { subscription: "구독", fiveHour: "5시간 창", sevenDay: "주간 창" },
  left: "{percent} 남음",
  state: {
    measuring: "아직 측정하지 않았습니다. 이 화면이나 툴바의 사용량이 열려 있는 동안 측정합니다.",
    "at-limit": "사용 한도에 도달했습니다. 초기화될 때까지 선택되지 않습니다.",
    "no-answer": "마지막 확인에 응답이 없었습니다. 간격을 늘려 가며 다시 시도합니다.",
  },
  limitReset: "{window}: {at} 무렵 초기화 (마지막으로 확인한 값)",
  empty: "등록된 토큰이 없습니다.",
};
