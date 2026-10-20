/**
 * POST /api/contact { listing_id, move_in_date?, budget?, sharing_preference?, gender? }
 * Generates an honest personalized enquiry draft for the student to send directly.
 * "Agent drafted it. You send it."
 */
import { getListing } from "@/lib/listings";
import type { EnquiryDraft } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { listing_id, move_in_date, budget, sharing_preference, gender } = body;
  const l = getListing(String(listing_id));
  if (!l) return Response.json({ error: "Unknown listing" }, { status: 404 });

  const moveIn = move_in_date || "this week";
  const sharing = sharing_preference && sharing_preference !== "any" ? `${sharing_preference} sharing` : "a";
  const gen = gender && gender !== "any" ? `for ${gender}` : "";
  const bud = budget ? `, with my budget around Rs ${budget}/month` : "";
  const sourceName = l.sources[0]?.name || "public directories";

  const message =
    `Hi, I saw your accommodation listing for "${l.name}" via ${sourceName}. ` +
    `I am looking for ${sharing} room/bed ${gen} with move-in around ${moveIn}${bud}. ` +
    `Could you please let me know if a bed is currently available and what the current rent is? Thank you!`;

  let waLink: string | null = null;
  let telLink: string | null = null;
  let cleanPhone = l.contact_phone ? l.contact_phone.replace(/[^0-9]/g, "") : null;

  if (cleanPhone) {
    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
    waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    telLink = `tel:+${cleanPhone}`;
  }

  const draft: EnquiryDraft = {
    listing_id: l.id,
    listing_name: l.name,
    message,
    wa_link: waLink,
    tel_link: telLink,
    copy_text: message,
    phone: l.contact_phone || null,
    source_url: l.sources[0]?.url || l.website || null,
  };

  return Response.json(draft);
}
