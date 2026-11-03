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
