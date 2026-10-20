/**
 * Price colour shared by map pins and cards:
 * - grey = price unknown
 * - green = listed price within budget
 * - amber = near budget (within 15%)
 * - red = over budget
 */
export function priceColor(rent: number | null | undefined, budget: number | null): string {
  if (rent == null || rent <= 0) {
    return "#94a3b8"; // grey: price unknown
  }
  if (!budget) {
    return rent <= 7000 ? "#10b981" : rent <= 12000 ? "#fbbf24" : "#f87171";
  }
  if (rent <= budget) {
    return "#10b981"; // green: within budget
  }
  if (rent <= budget * 1.15) {
    return "#fbbf24"; // amber: near budget
  }
  return "#f87171"; // red: over budget
}
