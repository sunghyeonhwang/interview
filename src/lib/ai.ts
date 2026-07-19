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

/** 매직 바이트로 실제 이미지 포맷 판별 — 생성 엔진이 PNG 대신 JPEG를 반환하는 경우 대응 */
export function sniffMediaType(buf: Buffer): VisionImage["media_type"] {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") return "image/webp";
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return "image/png";
}

const sniffBase64 = (b64: string): VisionImage["media_type"] =>
  sniffMediaType(Buffer.from(b64.slice(0, 24), "base64"));

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

// Claude 실패(크레딧 소진·장애 등) 시 폴백: OpenAI 최고 추론 모델 (기본 gpt-5.6-sol, reasoning high)
// OPENAI_FALLBACK_MODEL 환경변수로 교체 가능. 모델 오류 시 체인의 다음 모델로 넘어간다.
const OPENAI_FALLBACK_MODELS = [...new Set([process.env.OPENAI_FALLBACK_MODEL ?? "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.2"])];

async function openaiReasoningCall(model: string, opts: ClaudeCallOpts, withSchema: boolean): Promise<string> {
  const client = new OpenAI();
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...(opts.images ?? []).map((img): OpenAI.Chat.Completions.ChatCompletionContentPart => {
      const o = typeof img === "string" ? { data: img, media_type: sniffBase64(img) } : img;
      return { type: "image_url", image_url: { url: `data:${o.media_type};base64,${o.data}` } };
    }),
    { type: "text", text: opts.prompt },
  ];
  const res = await client.chat.completions.create({
    model,
    reasoning_effort: "high",
    max_completion_tokens: opts.maxTokens ?? 16000,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content },
    ],
    ...(withSchema && opts.schema
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: { name: "output", strict: true, schema: opts.schema },
          },
        }
      : {}),
  });
  const out = res.choices?.[0]?.message?.content ?? "";
  if (!out) throw new Error("OpenAI 폴백 응답이 비어 있습니다.");
  return out;
}

async function openaiFallback(opts: ClaudeCallOpts): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 없어 폴백할 수 없습니다.");
  let lastError: unknown = null;
  for (const model of OPENAI_FALLBACK_MODELS) {
    try {
      return await openaiReasoningCall(model, opts, true);
    } catch (e) {
      // 스키마 비호환(strict) 등 형식 문제면 자유 출력으로 재시도 — extractJSON이 파싱한다
      if (/schema|response_format/i.test(String(e))) {
        try {
          return await openaiReasoningCall(model, opts, false);
        } catch (e2) {
          lastError = e2;
          continue;
        }
      }
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function claudeCall(opts: ClaudeCallOpts): Promise<string> {
  const imageBlocks = (opts.images ?? []).map((img): Anthropic.ContentBlockParam => {
    // 문자열 입력은 실제 바이트를 스니핑해 미디어 타입 판별 (PNG 가정 금지)
    const o = typeof img === "string" ? { data: img, media_type: sniffBase64(img) } : img;
    return { type: "image", source: { type: "base64", media_type: o.media_type, data: o.data } };
  });
  // 프롬프트 캐싱: 이미지들(레퍼런스·애셋 등)은 같은 파이프라인에서 반복 입력되므로
  // 마지막 이미지에 캐시 브레이크포인트를 걸어 앞부분 전체를 캐시한다 (5분 TTL)
  if (imageBlocks.length) {
    imageBlocks[imageBlocks.length - 1] = {
      ...imageBlocks[imageBlocks.length - 1],
      cache_control: { type: "ephemeral" },
    } as Anthropic.ContentBlockParam;
  }
  const content: Anthropic.ContentBlockParam[] = [...imageBlocks, { type: "text", text: opts.prompt }];

  let message: Anthropic.Message;
  try {
    const client = anthropic();
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      // 시스템 프롬프트는 호출 유형별로 고정 — 캐시로 재과금 방지
      system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
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
    message = await stream.finalMessage();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const creditIssue = /credit balance is too low/i.test(msg);
    // Claude 실패 → OpenAI 고추론 모델(gpt-5.2, reasoning high)로 폴백
    if (process.env.OPENAI_API_KEY) {
      try {
        return await openaiFallback(opts);
      } catch (fe) {
        const femsg = fe instanceof Error ? fe.message : String(fe);
        throw new Error(
          `Claude 실패(${creditIssue ? "크레딧 소진" : msg.slice(0, 120)}), OpenAI 폴백도 실패(${femsg.slice(0, 120)})`
        );
      }
    }
    if (creditIssue) {
      throw new Error("Anthropic API 크레딧이 소진되었습니다 — console.anthropic.com → Plans & Billing에서 충전 후 다시 시도해주세요.");
    }
    throw e;
  }

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

/** 이미지 생성 (실사용 모델 반환) — Gemini pro→flash 폴백 여부를 추적할 수 있다 */
export async function generateImageEx(
  engine: ImageEngine,
  prompt: string,
  inputImage?: Buffer
): Promise<{ buf: Buffer; model: string }> {
  if (engine === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
    const client = new OpenAI();
    try {
      const res = inputImage
        ? await client.images.edit({
            model: "gpt-image-1",
            image: await toFile(inputImage, `input.${sniffMediaType(inputImage) === "image/jpeg" ? "jpg" : "png"}`, { type: sniffMediaType(inputImage) }),
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
      return { buf: Buffer.from(b64, "base64"), model: "gpt-image-1" };
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
              { inlineData: { mimeType: sniffMediaType(inputImage), data: inputImage.toString("base64") } },
              { text: prompt },
            ]
          : prompt,
      });
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) return { buf: Buffer.from(part.inlineData.data, "base64"), model };
      }
      throw new Error("결과가 비어 있습니다 (정책 거부일 수 있음).");
    } catch (e) {
      lastError = e;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Gemini 이미지 생성 실패: ${msg.slice(0, 200)}`);
}

/** 이미지 생성 (Buffer만 필요할 때의 간이 래퍼) */
export async function generateImage(engine: ImageEngine, prompt: string, inputImage?: Buffer): Promise<Buffer> {
  return (await generateImageEx(engine, prompt, inputImage)).buf;
}
