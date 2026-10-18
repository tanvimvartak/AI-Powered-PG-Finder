/** Price colour shared by map pins and cards: green = comfortably within budget, amber = near budget, red = over. */
export function priceColor(rent: number, budget: number | null): string {
  if (!budget) return rent <= 5000 ? "#34d399" : rent <= 8000 ? "#fbbf24" : "#f87171";
  if (rent <= budget * 0.9) return "#34d399";
  if (rent <= budget) return "#fbbf24";
  return "#f87171";
}
