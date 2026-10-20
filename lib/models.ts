// OpenRouter models offered in the model picker (prices drift: labels say ~).
// Same curated list as the Themed Transformation Video Pipeline, recommended model first.
export const RECOMMENDED_MODEL = "google/gemini-3.7-flash";

export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "google/gemini-3.7-flash", label: "recommended, ~$0.75 / $3.75 per M tokens" },
  { id: "google/gemini-3.6-flash", label: "~$0.75 / $3.75 per M" },
  { id: "google/gemini-2.5-flash", label: "cheaper, ~$0.30 / $2.50 per M" },
  { id: "google/gemini-2.5-flash-lite", label: "cheapest Gemini, ~$0.10 / $0.40 per M" },
  { id: "openai/gpt-5-mini", label: "~$0.25 / $2 per M" },
  { id: "deepseek/deepseek-v4-flash-0731", label: "the .env default here, very cheap" },
  { id: "deepseek/deepseek-v4-flash-vision-exp", label: "very cheap, experimental" },
  { id: "anthropic/claude-sonnet-5.5", label: "high quality, ~$2 / $10 per M" },
  { id: "openai/gpt-5.5", label: "high quality, ~$5 / $30 per M" },
  { id: "google/gemma-4-31b-it:free", label: "free, often rate-limited" },
];

// OpenRouter accepts at most 3 models in a fallback chain.
export const MAX_MODELS = 3;
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

// "a/b, c/d" -> ["a/b", "c/d"] (at most 3); blank -> [] (use the default).
export function parseModelChain(value: unknown): { models: string[]; error: string } {
  const ids = String(value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const bad = ids.find((id) => !MODEL_ID.test(id));
  if (bad) {
    return { models: [], error: `Not an OpenRouter model id: ${bad.slice(0, 80)} (expected provider/model).` };
  }
  return { models: ids.slice(0, MAX_MODELS), error: "" };
}

// Free models and gpt-4o-mini work but are slow, often rate-limited and write weaker prompts.
export function isWeakChain(models: string[]): boolean {
  return models.length > 0 && models.every((id) => id.endsWith(":free") || id === "openai/gpt-4o-mini");
}
