/**
 * Calendar helpers for schedule_visit: .ics file + Google Calendar "add event" URL.
 * No OAuth needed. Times are interpreted as IST (UTC+05:30, no DST).
 */
import type { Listing } from "./types";

const IST_OFFSET_MIN = 330;

/** "2026-10-20T17:00" (IST, no TZ) → Date in UTC. */
export function istToDate(local: string): Date {
  const [d, t = "10:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hh, mm) - IST_OFFSET_MIN * 60000);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function visitDetails(listing: Listing) {
  return {
    title: `PG visit: ${listing.name}`,
    description: `Visit ${listing.name} (SAMPLE listing ${listing.id}).\nOwner: ${listing.owner_name}, ${listing.owner_phone}\nRent: Rs ${listing.monthly_rent}, deposit Rs ${listing.deposit}\nCarry: college ID, Aadhaar, 2 photos.\nScheduled by PG Finder Agent.`,
    location: listing.address,
  };
}

export function buildIcs(listing: Listing, localDatetime: string, durationMin = 45): string {
  const start = istToDate(localDatetime);
  const end = new Date(start.getTime() + durationMin * 60000);
  const { title, description, location } = visitDetails(listing);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PG Finder Agent//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${listing.id}-${stamp(start)}@pgfinder.local`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(location)}`,
    `GEO:${listing.lat};${listing.lng}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:PG visit in 1 hour",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function googleCalendarUrl(listing: Listing, localDatetime: string, durationMin = 45): string {
  const start = istToDate(localDatetime);
  const end = new Date(start.getTime() + durationMin * 60000);
  const { title, description, location } = visitDetails(listing);
  const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(start)}/${stamp(end)}`, details: description, location, ctz: "Asia/Kolkata" });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function whatsappLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
