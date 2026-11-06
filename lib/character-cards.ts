import type { Character } from "./types";

// A project's character list, read from pasted designs without the AI: every numbered heading ("### 1. ADHIYO BRAHMAN",
// "1. NAME", "**1. NAME**") starts a card whose number becomes its S number (S1…); the text under it is the description.
// A heading without a number gets the next free one; a heading with no text under it (a title) is skipped.

const HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:(\d{1,2})\s*[.)\-:]\s*)?(.+?)\s*(?:\*\*)?\s*$/;

export function parseCharacterCards(text: string): Character[] {
  const blocks: { number: number | null; name: string; body: string[] }[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isHeading = /^#{1,6}\s/.test(line) || /^(?:\*\*)?\s*\d{1,2}\s*[.)]\s+\S/.test(line) && line.length <= 80;
    const match = isHeading ? HEADING.exec(line.replace(/^#{1,6}\s*/, "")) : null;
    if (match) {
      blocks.push({ number: match[1] ? Number(match[1]) : null, name: match[2].replace(/\*\*/g, "").trim(), body: [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].body.push(line);
    }
  }
  const cards = blocks.filter((block) => block.body.length > 0 && block.name);
  const used = new Set(cards.flatMap((card) => (card.number && card.number < 100 ? [card.number] : [])));
  let next = 1;
  const out: Character[] = [];
  const taken = new Set<number>();
  for (const card of cards) {
    let number = card.number && card.number < 100 && !taken.has(card.number) ? card.number : 0;
    if (!number) {
      while (used.has(next) || taken.has(next)) next += 1;
      number = next;
    }
    taken.add(number);
    out.push({ id: `S${number}`, name: card.name.slice(0, 80), look: card.body.join(" ").replace(/\s+/g, " ").trim().slice(0, 2000) });
  }
  return out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

// The project card a story's character most likely is (same or contained name), for the S-number dropdown.
export function matchingCard(name: string, cards: Character[]): Character | undefined {
  const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const mine = plain(name);
  if (!mine) return undefined;
  return (
    cards.find((card) => plain(card.name) === mine) ||
    cards.find((card) => plain(card.name).split(" / ").some((part) => part === mine)) ||
    cards.find((card) => plain(card.name).includes(mine) || mine.includes(plain(card.name))) ||
    cards.find((card) => mine.split(" ").some((word) => word.length > 3 && plain(card.name).split(" ").includes(word)))
  );
}
