import { parseModelChain } from "./models";
import { rememberModel } from "./custom-models";
import { recordCost } from "./story-cost";

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

// OpenRouter's error as one short line, then (after a line break) the details: the provider's own error, which
// "Provider returned error" hides, its name, the status code and the model. Pages show the first line and the rest
// under "Details".
export function openRouterError(
  error: { message?: string; code?: number | string; metadata?: { raw?: unknown; provider_name?: string; reasons?: unknown } } | undefined,
  status: number,
  model: string,
): string {
  const provider = error?.metadata?.provider_name;
  const rawValue = error?.metadata?.raw;
  const raw = typeof rawValue === "string" ? rawValue : rawValue !== undefined ? JSON.stringify(rawValue) : "";
  // The provider's own message, when its raw answer is JSON with one.
  let inner = "";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    inner = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || parsed.message || "";
  } catch {
    inner = raw.length <= 200 ? raw : "";
  }
  const head = error?.message || `OpenRouter request failed (${status}).`;
  const short = `${head}${provider ? ` (${provider})` : ""}${inner && inner !== head ? `: ${inner.slice(0, 200)}` : ""}`;
  const details = [
    `Status: ${error?.code ?? status}`,
    `Model: ${model}`,
    provider ? `Provider: ${provider}` : "",
    raw ? `Provider's answer: ${raw.slice(0, 4000)}` : "",
    error?.metadata?.reasons !== undefined ? `Reasons: ${JSON.stringify(error.metadata.reasons).slice(0, 1000)}` : "",
  ].filter(Boolean);
  return [short, ...details].join("\n");
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
  let body: {
    error?: { message?: string; code?: number | string; metadata?: { raw?: unknown; provider_name?: string; reasons?: unknown } };
    choices?: OpenRouterChoice[];
    model?: string;
    usage?: { cost?: number };
  };
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

  // Charged even when the answer turns out unusable, so counted before any check.
  await recordCost(body.usage?.cost);

  if (!response.ok) {
    const message = openRouterError(body.error, response.status, model);
    console.log(`[openrouter] ${model} failed: ${message.replace(/\n/g, " | ")}`);
    throw new Error(message);
  }

  const choice = body.choices?.[0];
  const content = readMessageText(choice);
  if (!content) {
    throw new Error(
      `OpenRouter returned an empty response${choice?.finish_reason ? ` (${choice.finish_reason})` : ""}.`,
    );
  }

  // A typed-in model that just worked joins the model list (the one of the chain that answered).
  await rememberModel(models.find((id) => id === body.model) || models[0]);
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
