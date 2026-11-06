"use client";

import { useState } from "react";
import { matchingCard } from "@/lib/character-cards";
import { characterIdProblems } from "@/lib/character-ids";
import type { Character } from "@/lib/types";

const TYPE_OWN = "__own__";

// "Edit S numbers": every character's S number in one form, so the same person keeps the same number across the parts
// of a story. With the project's character cards, each character picks its card from a list (preselected by name), and
// can take the card's name and description too. Saving renumbers the frames as well (no AI).
export function CharacterIdsEditor({
  characters,
  cards = [],
  onSave,
}: {
  characters: Character[];
  cards?: Character[];
  // next: old id -> new id; fromCards: old id -> the card whose name and description it takes.
  onSave: (next: Record<string, string>, fromCards: Record<string, Character>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  // Characters whose number is typed instead of picked from the cards.
  const [typed, setTyped] = useState<string[]>([]);
  const [useCards, setUseCards] = useState(true);
  if (!draft) {
    return (
      <button
        type="button"
        onClick={() => {
          setTyped([]);
          setDraft(
            Object.fromEntries(
              characters.map((character) => [character.id, matchingCard(character.name, cards)?.id || character.id]),
            ),
          );
        }}
        title="Change the S1, S2… numbers of the characters (from the project's character list, if it has one); the frames are updated to match, without the AI"
        className="rounded-full border border-line px-3 py-1 text-xs text-foreground hover:border-accent"
      >
        Edit S numbers
      </button>
    );
  }
  const ids = characters.map((character) => (draft[character.id] || "").trim().toUpperCase());
  const problems = characterIdProblems(ids);
  const card = (id: string) => cards.find((item) => item.id === id);
  const fromCards = Object.fromEntries(
    characters.flatMap((character, index) => {
      const chosen = card(ids[index]);
      return useCards && chosen && !typed.includes(character.id) ? [[character.id, chosen]] : [];
    }),
  ) as Record<string, Character>;
  const changed =
    characters.some((character, index) => ids[index] !== character.id) ||
    Object.entries(fromCards).some(([id, chosen]) => {
      const character = characters.find((item) => item.id === id);
      return character && (character.name !== chosen.name || character.look !== chosen.look);
    });
  return (
    <div className="w-full rounded-xl border border-accent/60 bg-card p-4 text-sm">
      <p className="mb-3 text-xs text-muted">
        {cards.length
          ? "Pick each character's card from the project's character list (guessed by name). "
          : "Give each character the number it has in your other stories or parts (add a character list to the project to pick from it). "}
        The frames and the story analysis are updated to the new numbers (no AI); the current prompts are cleared because they
        use the old numbers.
      </p>
      <div className="grid gap-2">
        {characters.map((character, index) => {
          const own = !cards.length || typed.includes(character.id);
          return (
            <div key={character.id} className="flex flex-wrap items-center gap-2">
              <span className="w-40 truncate text-foreground" title={character.name}>
                {character.name}
              </span>
              <span className="text-xs text-muted">{character.id} →</span>
              {own ? (
                <input
                  value={draft[character.id] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [character.id]: event.target.value })}
                  aria-label={`New number for ${character.name}`}
                  className={`w-16 rounded-md border bg-background px-2 py-1 font-mono text-xs ${
                    ids[index] !== character.id ? "border-accent" : "border-line"
                  }`}
                />
              ) : (
                <select
                  value={card(ids[index]) ? ids[index] : ""}
                  onChange={(event) => {
                    if (event.target.value === TYPE_OWN) {
                      setTyped([...typed, character.id]);
                      return;
                    }
                    setDraft({ ...draft, [character.id]: event.target.value || character.id });
                  }}
                  aria-label={`Project character for ${character.name}`}
                  className={`max-w-72 rounded-md border bg-background px-2 py-1 text-xs ${
                    ids[index] !== character.id ? "border-accent text-foreground" : "border-line text-muted"
                  }`}
                >
                  <option value="">Keep {character.id} (not in the list)</option>
                  {cards.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.name}
                    </option>
                  ))}
                  <option value={TYPE_OWN}>Type a number…</option>
                </select>
              )}
              {cards.length > 0 && own && (
                <button
                  type="button"
                  onClick={() => setTyped(typed.filter((id) => id !== character.id))}
                  className="text-xs text-muted hover:text-foreground"
                >
                  pick from list
                </button>
              )}
            </div>
          );
        })}
      </div>
      {cards.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={useCards} onChange={(event) => setUseCards(event.target.checked)} />
          Also use each picked card&apos;s name and description
        </label>
      )}
      {problems.length > 0 && <p className="mt-2 text-xs text-red-300">{problems.join(" ")}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!changed || problems.length > 0}
          onClick={() => {
            onSave(Object.fromEntries(characters.map((character, index) => [character.id, ids[index]])), fromCards);
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
