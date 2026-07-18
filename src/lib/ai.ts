import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";

// ── Claude: 기획·서치·프롬프트 구성·SVG 재작성 ──────────────────
const CLAUDE_MODEL = process.env.PIPELINE_MODEL ?? "claude-opus-4-8";

function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  return new Anthropic();
}

export interface VisionImage {
  data: string; // base64
  media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

interface ClaudeCallOpts {
  system: string;
  prompt: string;
  /** 비전 입력 — 문자열이면 base64 PNG로 간주 */
  images?: (string | VisionImage)[];
  /** JSON Schema — 지정 시 구조화 출력 강제 (서버 툴과 병용 금지) */
  schema?: Record<string, unknown>;
  /** 웹 서치 툴 활성화 (Pinterest 차단 내장) */
  useWebSearch?: boolean;
  maxTokens?: number;
  /** 사고 깊이 — 지연시간 민감 단계는 medium 권장 (기본 high) */
  effort?: "low" | "medium" | "high";
}

export async function claudeCall(opts: ClaudeCallOpts): Promise<string> {
  const client = anthropic();
  const content: Anthropic.ContentBlockParam[] = [
    ...(opts.images ?? []).map((img): Anthropic.ContentBlockParam => {
      const o = typeof img === "string" ? { data: img, media_type: "image/png" as const } : img;
      return { type: "image", source: { type: "base64", media_type: o.media_type, data: o.data } };
    }),
    { type: "text", text: opts.prompt },
  ];

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: opts.system,
    messages: [{ role: "user", content }],
    output_config: {
      effort: opts.effort ?? "high",
      ...(opts.schema && { format: { type: "json_schema" as const, schema: opts.schema } }),
    },
    ...(opts.useWebSearch && {
      tools: [
        {
          type: "web_search_20260209" as const,
          name: "web_search" as const,
          max_uses: 4,
          blocked_domains: ["pinterest.com", "kr.pinterest.com", "pinterest.co.kr", "pin.it"],
        },
      ],
    }),
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("요청이 안전 정책에 의해 거부되었습니다. 프롬프트를 수정해 다시 시도해주세요.");
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 응답 텍스트에서 JSON 객체를 추출 (구조화 출력 또는 자유 텍스트 내 JSON) */
export function extractJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return JSON.parse(fence[1]) as T;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
  throw new Error("응답에서 JSON을 찾지 못했습니다.");
}

// ── Gemini 텍스트 + Google Search grounding (레퍼런스 서치 전용 — 응답 수 초) ──
export async function geminiSearch(system: string, prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: system,
      tools: [{ googleSearch: {} }],
    },
  });
  return res.text ?? "";
}

// ── 이미지 생성: OpenAI gpt-image-1 / Gemini ──────────────────
export type ImageEngine = "openai" | "gemini";

export function availableEngines(): ImageEngine[] {
  const engines: ImageEngine[] = [];
  if (process.env.OPENAI_API_KEY) engines.push("openai");
  if (process.env.GEMINI_API_KEY) engines.push("gemini");
  return engines;
}

/** 이미지 생성. inputImage(PNG Buffer)를 주면 그 이미지를 기반으로 편집·합성한다 (목업 등) */
export async function generateImage(engine: ImageEngine, prompt: string, inputImage?: Buffer): Promise<Buffer> {
  if (engine === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
    const client = new OpenAI();
    try {
      const res = inputImage
        ? await client.images.edit({
            model: "gpt-image-1",
            image: await toFile(inputImage, "input.png", { type: "image/png" }),
            prompt,
            size: "1024x1024",
            quality: "high",
          })
        : await client.images.generate({
            model: "gpt-image-1",
            prompt,
            size: "1024x1024",
            quality: "high",
          });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI 이미지 생성 결과가 비어 있습니다.");
      return Buffer.from(b64, "base64");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`OpenAI 이미지 생성 실패: ${msg.slice(0, 200)}`);
    }
  }

  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // 상위 모델(Nano Banana Pro) 우선 — 실패 시 flash로 폴백
  const models = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
  let lastError: unknown = null;
  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: inputImage
          ? [
              { inlineData: { mimeType: "image/png", data: inputImage.toString("base64") } },
              { text: prompt },
            ]
          : prompt,
      });
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
      }
      throw new Error("결과가 비어 있습니다 (정책 거부일 수 있음).");
    } catch (e) {
      lastError = e;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Gemini 이미지 생성 실패: ${msg.slice(0, 200)}`);
}
