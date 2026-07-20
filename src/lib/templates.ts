import type { QuestionType, ScaleOptions } from "@/lib/types";

// 질문지 템플릿 정본.
// 새 질문지를 "템플릿에서 만들기"로 즉시 찍어낼 수 있도록 미리 정의한 문항 세트.
// 향후 템플릿을 늘리려면 TEMPLATES 배열에 QuestionnaireTemplate를 추가하면
// Dashboard 버튼과 from-template API가 자동으로 인식한다.

export interface TemplateQuestion {
  type: QuestionType;
  prompt: string;
  guide?: string;
  // single/multi → 보기 문자열 배열, scale → 최소/최대와 양 끝 라벨, text/short → 없음
  options?: string[] | ScaleOptions;
  required?: boolean;
}

export interface TemplateSection {
  title: string;
  guide?: string;
  questions: TemplateQuestion[];
}

export interface QuestionnaireTemplate {
  key: string;
  title: string;
  description: string;
  sections: TemplateSection[];
}

const brandLogoRenewal: QuestionnaireTemplate = {
  key: "brand-logo-renewal",
  title: "브랜드 로고 개선(리뉴얼) 인터뷰",
  description: "기존 로고를 가진 브랜드의 개선 방향을 파악하는 사전 질문지입니다. 30분 내외.",
  sections: [
    {
      title: "현재 로고 진단",
      guide: "지금 로고를 어떻게 느끼시는지 솔직하게 적어주세요. 정답은 없습니다.",
      questions: [
        {
          type: "text",
          prompt: "현재 로고는 언제, 어떤 과정으로 만들어졌나요?",
          guide: "만든 주체(내부·외주·직접)와 당시 의도도 함께 적어주세요.",
          required: true,
        },
        {
          type: "text",
          prompt: "현재 로고에서 꼭 유지하고 싶은 요소는 무엇인가요?",
          guide: "형태·색·심볼·글자꼴 등. 없다면 '없음'이라고 적어주세요.",
          required: true,
        },
        {
          type: "text",
          prompt: "가장 불만족스러운 점은 무엇인가요?",
          guide: "구체적인 상황이 있으면 함께 — 예: 작게 쓰면 안 보인다, 낡아 보인다는 말을 들었다.",
          required: true,
        },
        {
          type: "text",
          prompt: "왜 '지금' 개선하려고 하시나요?",
          guide: "사업 확장, 리브랜딩, 이미지 노후 등 계기를 알려주세요.",
          required: true,
        },
        {
          type: "scale",
          prompt: "현재 로고에 대한 애착도",
          options: { min: 1, max: 5, minLabel: "완전히 바꿔도 좋다", maxLabel: "최대한 지키고 싶다" },
          required: true,
        },
      ],
    },
    {
      title: "브랜드 이해",
      questions: [
        {
          type: "short",
          prompt: "브랜드를 한 문장으로 소개한다면?",
          required: true,
        },
        {
          type: "short",
          prompt: "고객이 새 로고를 보고 떠올렸으면 하는 단어 3가지",
          required: true,
        },
        {
          type: "text",
          prompt: "주 고객은 어떤 사람들인가요?",
          guide: "연령대·성향·브랜드를 만나는 상황",
        },
        {
          type: "text",
          prompt: "경쟁 브랜드와 '이것만은 달라 보이고 싶다' 하는 점은?",
        },
      ],
    },
    {
      title: "방향 스케일",
      guide: "정답 없이 직관적으로. 양 끝 사이 어디쯤인지 골라주세요.",
      questions: [
        {
          type: "scale",
          prompt: "클래식 ↔ 모던",
          options: { min: 1, max: 5, minLabel: "클래식", maxLabel: "모던" },
        },
        {
          type: "scale",
          prompt: "친근한 ↔ 전문적인",
          options: { min: 1, max: 5, minLabel: "친근한", maxLabel: "전문적인" },
        },
        {
          type: "scale",
          prompt: "절제된 ↔ 대담한",
          options: { min: 1, max: 5, minLabel: "절제된", maxLabel: "대담한" },
        },
        {
          type: "scale",
          prompt: "수공예적 ↔ 기하학적",
          options: { min: 1, max: 5, minLabel: "수공예적", maxLabel: "기하학적" },
        },
      ],
    },
    {
      title: "개선 범위와 제약",
      questions: [
        {
          type: "single",
          prompt: "개선 폭을 어느 정도로 생각하시나요?",
          options: [
            "리터치 — 지금 로고를 다듬는 수준",
            "리디자인 — 인상은 잇되 형태는 새로",
            "전면 리뉴얼 — 완전히 새로",
            "모르겠다 — 제안을 보고 정하고 싶다",
          ],
          required: true,
        },
        {
          type: "multi",
          prompt: "반드시 유지해야 하는 자산",
          options: [
            "심볼(마크)",
            "워드마크(글자꼴)",
            "브랜드 컬러",
            "전용 서체",
            "슬로건",
            "없음 — 전부 바뀌어도 된다",
          ],
        },
        {
          type: "multi",
          prompt: "로고가 주로 쓰이는 곳(모두 선택)",
          options: [
            "웹사이트",
            "앱 아이콘",
            "인쇄물(명함·브로슈어)",
            "간판·사인",
            "패키지",
            "영상",
            "굿즈·의류",
            "SNS 프로필",
          ],
          required: true,
        },
        {
          type: "text",
          prompt: "피해야 할 것이 있나요?",
          guide: "특정 색·형태, 경쟁사와 겹치는 표현, 종교·문화적 금기 등",
        },
      ],
    },
    {
      title: "취향·레퍼런스와 진행",
      questions: [
        {
          type: "text",
          prompt: "좋아 보였던 로고·브랜드 사례와 이유",
          guide: "동종업계가 아니어도 좋습니다. 링크 환영.",
        },
        {
          type: "text",
          prompt: "별로라고 느낀 사례와 이유",
        },
        {
          type: "short",
          prompt: "새 로고가 필요한 시점은 언제인가요?",
        },
        {
          type: "short",
          prompt: "최종 결정은 누가 하나요?",
          guide: "혼자 / 공동 / 대표 승인 등",
          required: true,
        },
        {
          type: "text",
          prompt: "이번 개선이 '성공했다'고 판단할 기준은 무엇인가요?",
          required: true,
        },
      ],
    },
  ],
};

export const TEMPLATES: QuestionnaireTemplate[] = [brandLogoRenewal];

export function getTemplate(key: string): QuestionnaireTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
