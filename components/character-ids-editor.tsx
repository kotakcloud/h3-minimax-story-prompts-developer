"use client";

import { useState } from "react";
import { characterIdProblems } from "@/lib/character-ids";
import type { Character } from "@/lib/types";

// "Edit S numbers": every character's S number in one form, so the same person can keep the same number across the
// parts of a story. Saving renumbers the frames too (no AI).
export function CharacterIdsEditor({
  characters,
  onSave,
}: {
  characters: Character[];
  onSave: (next: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  if (!draft) {
    return (
      <button
        type="button"
        onClick={() => setDraft(Object.fromEntries(characters.map((character) => [character.id, character.id])))}
        title="Change the S1, S2… numbers of the characters; the frames are updated to match, without the AI"
        className="rounded-full border border-line px-3 py-1 text-xs text-foreground hover:border-accent"
      >
        Edit S numbers
      </button>
    );
  }
  const ids = characters.map((character) => (draft[character.id] || "").trim().toUpperCase());
  const problems = characterIdProblems(ids);
  const changed = characters.some((character, index) => ids[index] !== character.id);
  return (
    <div className="w-full rounded-xl border border-accent/60 bg-card p-4 text-sm">
      <p className="mb-3 text-xs text-muted">
        Give each character the number it has in your other stories or parts. The frames and the story analysis are updated
        to the new numbers (no AI); the current prompts are cleared because they use the old numbers.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {characters.map((character, index) => (
          <label key={character.id} className="flex items-center gap-2">
            <input
              value={draft[character.id] ?? ""}
              onChange={(event) => setDraft({ ...draft, [character.id]: event.target.value })}
              aria-label={`New number for ${character.name}`}
              className={`w-16 rounded-md border bg-background px-2 py-1 font-mono text-xs ${
                ids[index] !== character.id ? "border-accent" : "border-line"
              }`}
            />
            <span className="truncate text-foreground">{character.name}</span>
            {ids[index] !== character.id && <span className="text-xs text-muted">was {character.id}</span>}
          </label>
        ))}
      </div>
      {problems.length > 0 && <p className="mt-2 text-xs text-red-300">{problems.join(" ")}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!changed || problems.length > 0}
          onClick={() => {
            onSave(Object.fromEntries(characters.map((character, index) => [character.id, ids[index]])));
            setDraft(null);
          }}
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          Save numbers
        </button>
        <button type="button" onClick={() => setDraft(null)} className="px-2 py-1.5 text-xs text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
