/**
 * Price colour shared by map pins and cards using the Modern Calm Trustworthy palette:
 * - Slate (#64748B) = price unknown
 * - Deep Teal (#1E5D4B) = listed price within budget
 * - Terracotta (#F08A5D) = near budget (within 15%)
 * - Red (#DC2626) = over budget
 */
export function priceColor(rent: number | null | undefined, budget: number | null): string {
  if (rent == null || rent <= 0) {
    return "#64748B"; // slate: price unknown
  }
  if (!budget) {
    return rent <= 7000 ? "#1E5D4B" : rent <= 12000 ? "#F08A5D" : "#DC2626";
  }
  if (rent <= budget) {
    return "#1E5D4B"; // deep teal: within budget
  }
  if (rent <= budget * 1.15) {
    return "#F08A5D"; // terracotta: near budget
  }
  return "#DC2626"; // red: over budget
}
