const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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

export async function chatCompletion(
  messages: ChatMessage[],
  options?: { maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local.");
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "H3 Story Prompt Workshop",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: options?.maxTokens ?? 8000,
      reasoning: { effort: "low" },
      messages,
    }),
  });

  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: OpenRouterChoice[];
  };

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

export async function chatJson(
  system: string,
  user: string,
  options?: { maxTokens?: number },
): Promise<unknown> {
  const first = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
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
        { role: "user", content: user },
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
