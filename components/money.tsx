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
