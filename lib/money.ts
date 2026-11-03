// Money as shown in the app: US dollars with rupees next to them, at a fixed, rounded rate.
export const INR_PER_USD = 100;

export function formatInr(usd: number): string {
  const inr = usd * INR_PER_USD;
  return `₹${inr >= 10 ? Math.round(inr).toLocaleString("en-IN") : inr.toFixed(2)}`;
}

// "$0.042 (₹4.20)"; small amounts get a third decimal so a single call still shows.
export function formatMoney(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 1 ? 3 : 2)} (${formatInr(usd)})`;
}

// Adds rupees after every dollar amount in a text: "~$0.75 per M" -> "~$0.75 (₹75) per M".
export function withInr(text: string): string {
  return text.replace(/\$(\d+(?:\.\d+)?)/g, (amount, value: string) => `${amount} (${formatInr(Number(value))})`);
}
