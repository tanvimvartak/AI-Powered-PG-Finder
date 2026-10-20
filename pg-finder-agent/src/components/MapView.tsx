"use client";
/**
 * Leaflet + OpenStreetMap map in clean Modern Calm Trustworthy styling.
 * - search radius circle with auto-fit zoom for any radius
 * - landmark marker in Deep Teal
 * - listing pins colour-coded by price vs budget (Deep Teal, Terracotta, Red, Slate)
 * - subtle slate pins for OpenStreetMap (Overpass) hostels without price data
 */
import L from "leaflet";
import { useEffect } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { ListingHit, OsmPlace } from "@/lib/types";
import { priceColor } from "@/lib/price";

export interface MapViewProps {
  center: { lat: number; lng: number } | null;
  landmark: string | null;
  radius_m: number;
  hits: ListingHit[];
  osm: OsmPlace[];
  budget: number | null;
  rankOf: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function pinIcon(color: string, label: string, selected: boolean) {
  const size = selected ? 38 : 30;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
    html: `<div class="pin" style="width:${size}px;height:${size}px;display:grid;place-items:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2.5px solid ${selected ? "#F08A5D" : "#FFFFFF"};box-shadow:0 4px 14px rgba(30,93,75,0.25)">
      <span style="transform:rotate(45deg);font:700 ${selected ? 13 : 11}px/1 Outfit,sans-serif;color:#FFFFFF">${label}</span></div>`,
  });
}

const landmarkIcon = L.divIcon({
  className: "",
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  html: `<div style="position:relative;width:44px;height:44px;display:grid;place-items:center">
    <span class="mic-ring" style="background:rgba(79,143,116,.35)"></span>
    <div style="position:relative;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#1E5D4B;border:2.5px solid #FFFFFF;font-size:16px;box-shadow:0 4px 12px rgba(30,93,75,0.3)">🎓</div></div>`,
});

const osmIcon = L.divIcon({
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div class="pin" style="width:14px;height:14px;border-radius:50%;background:#64748B;border:2px solid #FFFFFF;box-shadow:0 2px 6px rgba(0,0,0,0.15)"></div>`,
});

/** Fit zoom to the radius circle whenever centre/radius changes. */
function FitToRadius({ center, radius }: { center: { lat: number; lng: number } | null; radius: number }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    if (!center) return;
    map.invalidateSize();
    const bounds = L.latLng(center.lat, center.lng).toBounds(radius * 2.15);
    map.flyToBounds(bounds, { duration: 0.9, padding: [20, 20] });
  }, [center, radius, map]);
  return null;
}

/** Pan to the selected listing. */
function FocusSelected({ hit }: { hit: ListingHit | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (hit) map.panTo([hit.lat, hit.lng], { animate: true });
  }, [hit, map]);
  return null;
}

export default function MapView({ center, landmark, radius_m, hits, osm, budget, rankOf, selectedId, onSelect }: MapViewProps) {
  const fallback = { lat: 19.076, lng: 72.8777 }; // Mumbai
  return (
    <MapContainer center={[fallback.lat, fallback.lng]} zoom={11} className="h-full w-full" zoomControl={false} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToRadius center={center} radius={radius_m} />
      <FocusSelected hit={hits.find((h) => h.id === selectedId)} />
      {center && (
        <>
          <Circle
            center={[center.lat, center.lng]}
            radius={radius_m}
            pathOptions={{ color: "#1E5D4B", weight: 2, fillColor: "#1E5D4B", fillOpacity: 0.08, dashArray: "6 6" }}
          />
          <Marker position={[center.lat, center.lng]} icon={landmarkIcon} zIndexOffset={1000}>
            <Popup>
              <div className="font-semibold text-slate-800">{landmark ?? "Landmark"}</div>
              <div className="text-xs text-slate-500">Search centre</div>
            </Popup>
          </Marker>
        </>
      )}
      {osm.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={osmIcon}>
          <Popup>
            <b className="text-slate-800">{p.name}</b>
            <br />
            <span className="text-xs text-slate-600">
              OpenStreetMap {p.kind.replace("_", " ")} · {(p.distance_m / 1000).toFixed(1)} km
            </span>
            <br />
            <i className="text-xs text-slate-400">No price info listed</i>
          </Popup>
        </Marker>
      ))}
      {hits.map((h) => {
        const rank = rankOf[h.id];
        const isUnknown = h.price_status === "unknown" || h.monthly_rent === null;
        return (
          <Marker
            key={h.id}
            position={[h.lat, h.lng]}
            icon={pinIcon(priceColor(h.monthly_rent, budget), rank ? `#${rank}` : isUnknown ? "?" : "₹", selectedId === h.id)}
            zIndexOffset={rank ? 500 - rank : 0}
            eventHandlers={{ click: () => onSelect(h.id) }}
          >
            <Popup>
              <div className="space-y-1">
                <b className="text-sm font-semibold text-slate-900">{h.name}</b>
                <div className="text-xs text-slate-600">
                  {isUnknown ? (
                    <span className="font-medium text-slate-600">Price not listed (ask owner)</span>
                  ) : (
                    <span className="font-bold text-[#1E5D4B]">₹{h.monthly_rent?.toLocaleString("en-IN")}/mo</span>
                  )}
                  {" · "}
                  {(h.distance_m / 1000).toFixed(2)} km
                </div>
                <div>
                  {h.is_sample ? (
                    <span className="badge-sample">Sample data</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      Source: {(h.sources || []).map((s) => s.name).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
