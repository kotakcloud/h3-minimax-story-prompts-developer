"use client";

import { useEffect, useState } from "react";

export type LoraSetting = { name: string; strength: number; enabled: boolean };
type LoraInfo = { name: string; label: string; speed: boolean };

// Popup to pick enhancement LoRAs and their strengths. The list is scanned fresh from ComfyUI every
// time it opens, so LoRAs added to models/loras/minimax-h3 show up without restarting anything.
type Props = {
  open: boolean;
  value: LoraSetting[];
  onClose: () => void;
  onSave: (next: LoraSetting[]) => void;
};

export function LoraDialog(props: Props) {
  // Mounted fresh on every open: the draft starts from the saved choice and the list is rescanned.
  return props.open ? <LoraDialogBody {...props} /> : null;
}

function LoraDialogBody({ value, onClose, onSave }: Props) {
  const [available, setAvailable] = useState<LoraInfo[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<LoraSetting[]>(value);
  // Speed LoRAs are hidden by default (the fast workflows carry their own); an enabled one stays visible.
  const [hideSpeed, setHideSpeed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/loras")
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || "Could not list the LoRAs.");
        setAvailable(data.loras || []);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not list the LoRAs."));
    return () => {
      cancelled = true;
    };
  }, []);

  const settingOf = (name: string) => draft.find((item) => item.name === name) || { name, strength: 1, enabled: false };
  const update = (name: string, patch: Partial<LoraSetting>) =>
    setDraft((current) => {
      const next = { ...settingOf(name), ...patch };
      return current.some((item) => item.name === name)
        ? current.map((item) => (item.name === name ? next : item))
        : [...current, next];
    });
  const missing = draft.filter((item) => item.enabled && available && !available.some((lora) => lora.name === item.name));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 pb-16" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-card p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Enhancement LoRAs</h2>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={hideSpeed} onChange={(event) => setHideSpeed(event.target.checked)} />
            Hide speed LoRAs
            {hideSpeed && available && (
              <span>({available.filter((lora) => lora.speed && !settingOf(lora.name).enabled).length} hidden)</span>
            )}
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          From ComfyUI&apos;s models/loras/minimax-h3, scanned just now. Enabled LoRAs are added after the model of
          whichever workflow you render, in this order. Speed LoRAs are marked: the fast workflows already carry their
          own, so adding another one changes how they sample.
        </p>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {!available && !error && <p className="mt-3 text-sm text-muted">Scanning…</p>}
        {available && (
          <ul className="mt-4 space-y-2">
            {available.filter((lora) => !hideSpeed || !lora.speed || settingOf(lora.name).enabled).map((lora) => {
              const setting = settingOf(lora.name);
              return (
                <li
                  key={lora.name}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${
                    setting.enabled ? "border-accent/60 bg-accent/5" : "border-line"
                  }`}
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={setting.enabled}
                      onChange={(event) => update(lora.name, { enabled: event.target.checked })}
                    />
                    <span className="truncate" title={lora.name}>
                      {lora.label}
                    </span>
                    {lora.speed && (
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase text-muted">
                        speed
                      </span>
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    strength
                    <input
                      type="range"
                      min={-1}
                      max={2}
                      step={0.05}
                      value={setting.strength}
                      onChange={(event) => update(lora.name, { strength: Number(event.target.value) })}
                      className="w-28"
                    />
                    <input
                      type="number"
                      min={-2}
                      max={2}
                      step={0.05}
                      value={setting.strength}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) update(lora.name, { strength: Math.max(-2, Math.min(2, next)) });
                      }}
                      className="w-16 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                    />
                  </label>
                </li>
              );
            })}
            {available.length === 0 && <li className="text-sm text-muted">No LoRAs found in minimax-h3.</li>}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-amber-300">
            Enabled but no longer in ComfyUI: {missing.map((item) => item.name).join(", ")}. They will be dropped.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={!available}
            onClick={() =>
              onSave(
                draft.filter(
                  (item) => !item.enabled || available?.some((lora) => lora.name === item.name),
                ),
              )
            }
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
