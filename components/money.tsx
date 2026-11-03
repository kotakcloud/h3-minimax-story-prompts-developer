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
