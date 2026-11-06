"use client";

import { useId, useState } from "react";
import { MoneyText } from "@/components/money";
import { modelPrice, useModelOptions } from "@/components/use-model-options";
import { modelLabel, parseModelChain } from "@/lib/models";
import { withInr } from "@/lib/money";

// A step's own AI model (Frames, Prompts): blank = the story's model. Free text with the model list (built-in models
// with prices, plus models added after they worked), so any OpenRouter id can be typed. A choice applies when it is
// picked from the list, on Enter or when leaving the box (not on every key).
export function StepModelSelect({
  step,
  label = "AI model",
  value,
  storyModel,
  defaults,
  onChange,
}: {
  step: string;
  label?: string;
  value: string;
  storyModel: string;
  defaults: string[];
  onChange: (model: string) => void;
}) {
  const listId = useId();
  const { options } = useModelOptions();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const parsed = parseModelChain(shown);
  const commit = (text: string) => {
    const next = text.trim();
    if (parseModelChain(next).error) return;
    setDraft(null);
    if (next !== value) onChange(next);
  };
  const price = modelPrice(options, shown || storyModel);
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-2" title={`The AI model for every AI action on the ${step} step; blank = the story's model`}>
        {label}
        <input
          type="text"
          list={listId}
          autoComplete="off"
          spellCheck={false}
          value={shown}
          placeholder={`story model (${modelLabel(storyModel, defaults)})`}
          onChange={(event) => {
            const text = event.target.value;
            // Picked from the list: apply at once.
            if (options.some((option) => option.id === text)) commit(text);
            else setDraft(text);
          }}
          onBlur={() => draft !== null && commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Used up here, and applied after it: a dialog that opens on the change must not get this Enter.
              event.preventDefault();
              const text = event.currentTarget.value;
              window.setTimeout(() => commit(text), 0);
            }
            if (event.key === "Escape") setDraft(null);
          }}
          className={`w-64 rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent ${
            value ? "border-accent text-foreground" : "border-line text-muted"
          }`}
        />
      </label>
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.id} label={withInr(option.label)}>
            {withInr(option.label)}
          </option>
        ))}
      </datalist>
      {parsed.error ? (
        <span className="text-red-300">{parsed.error}</span>
      ) : (
        price && (
          <span title="Input / output price per million tokens">
            <MoneyText text={price.replace(/^(recommended|added by you),?\s*/, "")} />
          </span>
        )
      )}
      {value && (
        <button type="button" onClick={() => commit("")} className="hover:text-foreground" title="Use the story's model again">
          × story model
        </button>
      )}
    </span>
  );
}
