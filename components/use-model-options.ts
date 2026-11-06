"use client";

import { useEffect, useState } from "react";
import { MODEL_OPTIONS } from "@/lib/models";

export type ModelOption = { id: string; label: string };

// The .env default chain and every model offered in the model boxes: the built-in list, then the ones the owner added
// (kept after a successful call). Loaded once per page.
let loading: Promise<{ defaults: string[]; custom: ModelOption[] }> | null = null;

function load() {
  loading ??= fetch("/api/openrouter-models")
    .then((response) => response.json())
    .then((data: { defaultModels?: unknown; customModels?: unknown }) => ({
      defaults: Array.isArray(data?.defaultModels) ? data.defaultModels.filter((id): id is string => typeof id === "string") : [],
      custom: Array.isArray(data?.customModels)
        ? (data.customModels as ModelOption[]).filter((model) => typeof model?.id === "string" && typeof model?.label === "string")
        : [],
    }))
    .catch(() => {
      loading = null;
      return { defaults: [], custom: [] };
    });
  return loading;
}

export function useModelOptions(): { defaults: string[]; options: ModelOption[] } {
  const [state, setState] = useState<{ defaults: string[]; custom: ModelOption[] }>({ defaults: [], custom: [] });
  useEffect(() => {
    let cancelled = false;
    void load().then((data) => {
      if (!cancelled) setState(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const custom = state.custom.filter((model) => !MODEL_OPTIONS.some((option) => option.id === model.id));
  return { defaults: state.defaults, options: [...MODEL_OPTIONS, ...custom] };
}

// The price note of a model (or of a chain's first model), when it is in the list.
export function modelPrice(options: ModelOption[], value: string): string {
  const first = value.split(",")[0]?.trim();
  return options.find((option) => option.id === first)?.label || "";
}
