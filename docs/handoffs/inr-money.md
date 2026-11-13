# Handoff: show rupees (INR) alongside dollars (USD) for every cost in the app

Goal: wherever the app shows a cost in dollars, show it **rupees first** (green, the main figure), with the dollar
amount **small and dim** right after it, for example **₹954** $9.54. This uses a fixed rate, **1 USD = 100 INR**.
Nothing is fetched and there is no live exchange rate: the rupee figure is a quick sense of scale, not an exact
conversion.

This is already done in another project (H3 Story Prompt Workshop, Next.js + Tailwind). Copy the same three pieces here.

## 1. `lib/money.ts`: formatting (no React)

```ts
// Money as shown in the app: rupees first, US dollars after them, at a fixed, rounded rate.
export const INR_PER_USD = 100;

export function formatInr(usd: number): string {
  const inr = usd * INR_PER_USD;
  return `₹${inr >= 10 ? Math.round(inr).toLocaleString("en-IN") : inr.toFixed(2)}`;
}

// Small amounts get a third decimal so a single call still shows.
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 0.1 ? 3 : 2)}`;
}

// For plain text, where nothing can be styled (a <select> option): "~$0.75 per M" -> "~₹75 ($0.75) per M".
export function withInr(text: string): string {
  return text.replace(/\$(\d+(?:\.\d+)?)/g, (amount, value: string) => `${formatInr(Number(value))} (${amount})`);
}
```

Rules this gives:
- **₹10 and above:** a whole number with Indian grouping: ₹1,25,000.
- **Below ₹10:** two decimals: ₹4.20.
- **Dollars:** two decimals, or three below $0.10 so a single cheap call doesn't read $0.00.

## 2. `components/money.tsx`: the display component

```tsx
import { Fragment } from "react";
import { formatInr, formatUsd } from "@/lib/money";

// An amount in rupees (green, the main figure) with the dollars it came from, small and dim.
export function Money({ usd }: { usd: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-emerald-300">{formatInr(usd)}</span>{" "}
      <span className="text-[0.85em] text-muted opacity-70">{formatUsd(usd)}</span>
    </span>
  );
}

// A text with dollar amounts in it ("~$0.75 / $3.75 per M"), each shown as <Money>.
export function MoneyText({ text }: { text: string }) {
  return text.split(/(\$\d+(?:\.\d+)?)/).map((part, index) =>
    /^\$\d/.test(part) ? <Money key={index} usd={Number(part.slice(1))} /> : <Fragment key={index}>{part}</Fragment>,
  );
}
```

About the styles:
- `text-emerald-300`, `text-muted` and `whitespace-nowrap` are Tailwind classes. `text-muted` is that app's theme colour for dim text.
- Use this app's own equivalents. The intent: rupees green and medium weight, dollars about 85 % size and dimmed, and the pair never wrapping across lines.
- If this app isn't React, make the same markup in its own templating.
- Keep `"use client"` out of `money.tsx`. It has no state, so server and client components can both use it.

## 3. Use it everywhere a cost is shown

Search the code for every place a dollar amount is printed. Typical patterns:

- `` `$${x.toFixed(2)}` ``
- `"$" +`
- `toFixed(` near cost, usage, price or spend
- a literal `$` in JSX
- Intl currency formatting

Replace each by kind:

| Where | Use |
|---|---|
| JSX showing a number (header spend, per-item cost, totals, limits) | `<Money usd={amount} />` |
| JSX showing a text that already has `$` amounts in it (e.g. a model's price line from an API/catalog) | `<MoneyText text={line} />` |
| Plain text that cannot hold markup: `<option>` labels, `title=` tooltips, `window.confirm` text, `aria-label`s | `withInr(text)` → `₹75 ($0.75)` |

Notes:
- **Inputs stay in dollars.** Only the display changes. Stored values, API data and calculations all stay in USD. Don't convert anything you save.
- **Tooltips:** for a tooltip with an exact key total, plain `$` is fine, or wrap it in `withInr`. Be consistent within the app.
- **Missing values:** when an amount can be missing (`null`/`undefined`), keep the existing "hide when unknown" behaviour. Don't render ₹0.

## 4. Check it

1. Typecheck (`npx tsc --noEmit`) and lint.
2. Open each page that shows money and confirm:
   - rupees appear first, in green, with the dollars dim after them;
   - nothing wraps between the two;
   - the header still fits at phone width.
3. Check a tiny amount (under $0.10) and a large one (over $1,000), for example by calling `formatInr`/`formatUsd` in a quick script. Expect ₹4.20 $0.042 and ₹1,25,000 $1250.00.

## 5. Docs

Add a line to `usage.md` (and `README.md` if the project keeps one):

> Amounts show rupees first (green), with the dollars small and dim after them, at a fixed 1 USD = 100 INR (`lib/money.ts`). Plain-text spots such as dropdown options read ₹75 ($0.75).

Commit when verified; don't push.
