import { MODEL_OPTIONS, modelLabel } from "@/lib/models";
import { withInr } from "@/lib/money";

// A step's own AI model (Frames, Prompts): the story's model unless another one is picked here.
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
  const known = MODEL_OPTIONS.some((option) => option.id === value);
  return (
    <label className="flex items-center gap-2 text-xs text-muted" title={`The AI model for every AI action on the ${step} step`}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`max-w-64 rounded-md border bg-background px-2 py-1 text-xs ${value ? "border-accent text-foreground" : "border-line text-muted"}`}
      >
        <option value="">Story model ({modelLabel(storyModel, defaults)})</option>
        {value && !known && <option value={value}>{value}</option>}
        {MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.id} · {withInr(option.label)}
          </option>
        ))}
      </select>
    </label>
  );
}
