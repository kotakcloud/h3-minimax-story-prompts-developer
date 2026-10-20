"use client";

import { useEffect, useState } from "react";
import { MAX_MODELS, MODEL_OPTIONS, RECOMMENDED_MODEL, isWeakChain, parseModelChain } from "@/lib/models";

// Free text with a suggestion list (not a <select>): any OpenRouter id, or a comma-separated
// fallback chain of up to three. Blank = the .env default.
export function ModelPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [defaults, setDefaults] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/openrouter-models")
      .then((response) => response.json())
      .then((data: { defaultModels?: unknown }) => {
        if (Array.isArray(data?.defaultModels)) setDefaults(data.defaultModels.filter((id) => typeof id === "string"));
      })
      .catch(() => {});
  }, []);

  const typed = parseModelChain(value);
  const chain = typed.error ? [] : typed.models.length > 0 ? typed.models : defaults;
  const ignored = value.split(",").filter((id) => id.trim()).length > MAX_MODELS;

  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted">
        AI model (OpenRouter)
        <input
          type="text"
          list="openrouter-models"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="blank = .env default"
          title="Used by every AI step of this story. Comma-separate up to three ids for fallbacks."
          className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-accent"
        />
      </label>
      <datalist id="openrouter-models">
        {MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} label={option.label}>
            {option.label}
          </option>
        ))}
      </datalist>
      {value.trim() !== RECOMMENDED_MODEL && (
        <button
          type="button"
          onClick={() => onChange(RECOMMENDED_MODEL)}
          className="text-xs text-accent hover:underline"
          title="Fast and cheap (about a cent per call)"
        >
          Use recommended: gemini-3.7-flash
        </button>
      )}
      {typed.error ? (
        <p className="text-xs text-red-300">{typed.error}</p>
      ) : (
        chain.length > 0 && (
          <p
            className={`border-l-2 pl-2 text-xs ${
              isWeakChain(chain) ? "border-amber-400 bg-amber-400/10 text-amber-300" : "border-line text-muted"
            }`}
          >
            Currently: <code className="break-all">{chain[0]}</code>
            {chain.length > 1 && ` (+${chain.length - 1} fallback${chain.length > 2 ? "s" : ""})`}
            {typed.models.length === 0 && " (.env default)"}
            {ignored && `; only the first ${MAX_MODELS} are used`}
            {isWeakChain(chain) && (
              <span className="block">⚠ free/basic model: expect slower, less accurate results.</span>
            )}
          </p>
        )
      )}
    </div>
  );
}
