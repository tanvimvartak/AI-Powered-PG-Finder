/**
 * Visit scheduling (schedule_visit tool, also called by the "Confirm visit" button).
 *   POST /api/visit { listing_id, datetime } → { ics_url, gcal_url }
 *   GET  /api/visit?listing_id=..&datetime=YYYY-MM-DDTHH:MM → .ics download
 */
import { buildIcs, googleCalendarUrl } from "@/lib/ics";
import { getListing } from "@/lib/listings";

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function POST(req: Request) {
  const { listing_id, datetime } = await req.json().catch(() => ({}));
  const l = getListing(String(listing_id));
  const dt = String(datetime ?? "").slice(0, 16);
  if (!l) return Response.json({ error: "Unknown listing" }, { status: 404 });
  if (!DT.test(dt)) return Response.json({ error: "datetime must be YYYY-MM-DDTHH:MM" }, { status: 400 });
  return Response.json({ listing_id: l.id, datetime: dt, ics_url: `/api/visit?listing_id=${l.id}&datetime=${encodeURIComponent(dt)}`, gcal_url: googleCalendarUrl(l, dt) });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const l = getListing(url.searchParams.get("listing_id") ?? "");
  const dt = (url.searchParams.get("datetime") ?? "").slice(0, 16);
  if (!l || !DT.test(dt)) return new Response("Bad request", { status: 400 });
  return new Response(buildIcs(l, dt), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="pg-visit-${l.id}.ics"` },
  });
}
