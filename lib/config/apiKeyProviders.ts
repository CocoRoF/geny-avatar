/**
 * Client-safe provider metadata for the API key config UI. (The
 * server-side file I/O lives in `serverConfig.ts` — keep fs imports
 * out of this module so client components can import it.)
 */

import type { ProviderId } from "../ai/types";

export const API_KEY_PROVIDERS: ReadonlyArray<{
  id: ProviderId;
  label: string;
  envVar: string;
  hint: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    hint: "gpt-image 생성 + 프롬프트 refine (주력)",
  },
  { id: "falai", label: "fal.ai", envVar: "FAL_KEY", hint: "FLUX 계열 (선택)" },
  { id: "gemini", label: "Gemini", envVar: "GEMINI_API_KEY", hint: "Nano Banana (선택)" },
  {
    id: "replicate",
    label: "Replicate",
    envVar: "REPLICATE_API_TOKEN",
    hint: "SAM 자동 세그먼트",
  },
];
