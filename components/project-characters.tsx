"use client";

import { useState } from "react";
import { parseCharacterCards } from "@/lib/character-cards";
import type { Project } from "@/lib/types";

// A project's characters: paste the character designs, and each numbered heading becomes a card with its S number,
// shared by the project's stories (Edit S numbers on the Frames step offers them).
export function ProjectCharacters({
  project,
  projects = [],
  onSave,
}: {
  project: Project;
  // Other projects whose characters can be copied in.
  projects?: Project[];
  onSave: (characterText: string) => Promise<void>;
}) {
  const sources = projects.filter((item) => item.id !== project.id && item.characterText?.trim());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cards = project.characters || [];
  const text = draft ?? project.characterText ?? "";
  const preview = draft !== null ? parseCharacterCards(draft) : cards;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        {open ? "▾" : "▸"} Characters of {project.name} ({cards.length})
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {sources.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Copy from
              <select
                value=""
                onChange={(event) => {
                  const source = sources.find((item) => item.id === event.target.value);
                  if (source?.characterText) setDraft(source.characterText);
                }}
                aria-label="Copy the characters of another project"
                className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
              >
                <option value="">another project…</option>
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.characters?.length || 0})
                  </option>
                ))}
              </select>
              <span>fills the box below; check it, then Save (or Cancel).</span>
            </label>
          )}
          <label className="block text-xs text-muted">
            Paste the character designs. Each numbered heading (<code>### 1. NAME</code>) becomes a card: its number is the S
            number (S1, S2…) and the text under it the description.
            <textarea
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              rows={draft !== null || !cards.length ? 10 : 4}
              placeholder={"### 1. ADHIYO BRAHMAN\nA sturdy wanderer in his early thirties…\n\n### 2. GURUJI\nAn elderly saint…"}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
            />
          </label>
          {draft !== null && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(draft);
                    setDraft(null);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                {saving ? "Saving…" : `Save ${preview.length} ${preview.length === 1 ? "character" : "characters"}`}
              </button>
              <button type="button" onClick={() => setDraft(null)} className="px-2 py-1.5 text-xs text-muted hover:text-foreground">
                Cancel
              </button>
            </div>
          )}
          {preview.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {preview.map((card) => (
                <li key={card.id} className="rounded-xl border border-line bg-card p-3 text-xs">
                  <p className="text-foreground">
                    <span className="mr-2 font-mono text-accent">{card.id}</span>
                    {card.name}
                  </p>
                  <p className="mt-1 line-clamp-3 text-muted" title={card.look}>
                    {card.look}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
