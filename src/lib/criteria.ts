// 기본 평가 기준 (브랜딩_에이전트_세팅.md 합의 가중치) — 브리프에 criteria가 있으면 그것을 우선 사용
export interface Criterion {
  criterion: string;
  weight: number;
  hint?: string;
}

export const DEFAULT_CRITERIA: Criterion[] = [
  { criterion: "전략 적합성", weight: 25, hint: "브리프의 포지셔닝·방향과 얼마나 일치하는가" },
  { criterion: "고객 신뢰·이해도", weight: 20, hint: "핵심 고객이 신뢰를 느끼고 즉시 이해할 수 있는가" },
  { criterion: "차별성", weight: 15, hint: "업계 관습·경쟁 대비 구별되는가" },
  { criterion: "접점 확장성", weight: 15, hint: "간판·앱 아이콘·인쇄물 등 다양한 크기·매체에서 작동하겠는가" },
  { criterion: "가독성·접근성", weight: 15, hint: "명도 대비, 소형 사이즈 판독성, 색각 이상 고려" },
  { criterion: "제작·권리 리스크", weight: 10, hint: "제작 난이도, 기존 상표와의 유사 가능성, 규제 표현 리스크 (높을수록 안전)" },
];
