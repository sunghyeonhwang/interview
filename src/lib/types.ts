export type QuestionType = "text" | "short" | "single" | "multi" | "scale" | "image";

export interface Question {
  id: string;
  section_id?: string;
  type: QuestionType;
  prompt: string;
  guide: string | null;
  options: string[] | ScaleOptions | null;
  required: boolean;
  order: number;
}

export interface ScaleOptions {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface Section {
  id: string;
  title: string;
  guide: string | null;
  order: number;
  questions: Question[];
}

export interface Questionnaire {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  sections: Section[];
}

export interface Session {
  id: string;
  questionnaire_id: string;
  token: string;
  respondent_name: string;
  status: "pending" | "in_progress" | "submitted";
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
}

// 답변 값: text/short → string, single → string, multi → string[], scale → number,
// image → string(스토리지 경로. iv-uploads 버킷 기준 상대 경로)
export type AnswerValue = string | string[] | number;
export type AnswerMap = Record<string, AnswerValue>;
