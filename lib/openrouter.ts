import { parseModelChain } from "./models";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

// The .env default (OPENROUTER_MODEL may be a comma-separated fallback chain).
export function defaultModels(): string[] {
  const { models } = parseModelChain(process.env.OPENROUTER_MODEL);
  return models.length > 0 ? models : [DEFAULT_MODEL];
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

type OpenRouterMessage = {
  content?: string | { type?: string; text?: string }[];
  reasoning?: string;
};

type OpenRouterChoice = {
  finish_reason?: string;
  message?: OpenRouterMessage;
};

function readMessageText(choice: OpenRouterChoice | undefined): string {
  const message = choice?.message;
  const content = message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part === "string" ? part : part.text || ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (typeof message?.reasoning === "string" && message.reasoning.trim()) {
    return message.reasoning;
  }
  return "";
}

// models: the story's validated chain (at most 3); empty or missing = the .env default.
// images: data URLs attached to the user message (needs an image-capable model).
export type ChatOptions = { maxTokens?: number; timeoutMs?: number; models?: string[]; images?: string[] };

const DEFAULT_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 180_000;

export async function chatCompletion(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local.");
  }

  const models = options?.models?.length ? options.models : defaultModels();
  const model = models.join(", ");
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  let response: Response;
  let body: { error?: { message?: string }; choices?: OpenRouterChoice[]; model?: string };
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:38217",
        "X-Title": "H3 Story Prompt Workshop",
      },
      body: JSON.stringify({
        model: models[0],
        // OpenRouter tries these in order when the first one fails.
        ...(models.length > 1 ? { models } : {}),
        temperature: 0.4,
        max_tokens: options?.maxTokens ?? 8000,
        reasoning: { effort: "low" },
        messages,
      }),
    });
    body = (await response.json()) as typeof body;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      console.log(`[openrouter] ${model} timed out after ${Math.round(timeoutMs / 1000)}s`);
      throw new Error(`OpenRouter (${model}) did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  }
  console.log(
    `[openrouter] ${body.model && body.model !== models[0] ? `${model} -> answered by ${body.model}` : model} ${response.status} in ${((Date.now() - started) / 1000).toFixed(1)}s (max_tokens ${options?.maxTokens ?? 8000})`,
  );

  if (!response.ok) {
    throw new Error(body.error?.message || `OpenRouter request failed (${response.status}).`);
  }

  const choice = body.choices?.[0];
  const content = readMessageText(choice);
  if (!content) {
    throw new Error(
      `OpenRouter returned an empty response${choice?.finish_reason ? ` (${choice.finish_reason})` : ""}.`,
    );
  }

  return content;
}

export async function chatJson(system: string, user: string, options?: ChatOptions): Promise<unknown> {
  const userContent: ChatMessage["content"] = options?.images?.length
    ? [{ type: "text", text: user }, ...options.images.map((url) => ({ type: "image_url" as const, image_url: { url } }))]
    : user;
  const first = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    options,
  );

  try {
    const { extractJson } = await import("./parse");
    return extractJson(first);
  } catch {
    const repaired = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
        { role: "assistant", content: first },
        {
          role: "user",
          content:
            "Your previous reply was not valid JSON. Return ONLY one JSON object that matches the required schema. No markdown fences, no commentary.",
        },
      ],
      options,
    );
    const { extractJson } = await import("./parse");
    return extractJson(repaired);
  }
}
