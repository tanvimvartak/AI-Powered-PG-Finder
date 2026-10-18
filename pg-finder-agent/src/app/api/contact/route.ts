/**
 * POST /api/contact { listing_id, message, deadline_date?, max_budget? }
 * Lets the user ping an owner that the agent didn't contact (SIMULATED reply).
 */
import { simulateOwner } from "@/lib/agent/executor";
import { getListing } from "@/lib/listings";
import type { ParsedRequest } from "@/lib/types";

export async function POST(req: Request) {
  const { listing_id, message, deadline_date, max_budget } = await req.json().catch(() => ({}));
  const l = getListing(String(listing_id));
  if (!l) return Response.json({ error: "Unknown listing" }, { status: 404 });
  const msg = String(message || `Hi ${l.owner_name}, I'm a student looking for a bed at ${l.name}. Is it available, and when can I visit?`).slice(0, 600);
  const parsed = { deadline_date: deadline_date ?? null, max_budget: max_budget ?? null } as ParsedRequest;
  return Response.json(await simulateOwner(l.id, msg, parsed));
}
