"use client";
/**
 * Leaflet + OpenStreetMap map (no Google Maps).
 * - search radius circle with auto-fit zoom for any radius
 * - landmark marker
 * - listing pins colour-coded by price vs budget, dropping in live
 * - grey pins for OpenStreetMap (Overpass) hostels without price data
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
    html: `<div class="pin" style="width:${size}px;height:${size}px;display:grid;place-items:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid ${selected ? "#fff" : "rgba(10,10,22,.8)"};box-shadow:0 4px 14px ${color}88">
      <span style="transform:rotate(45deg);font:700 ${selected ? 13 : 11}px/1 Outfit,sans-serif;color:#0a0a16">${label}</span></div>`,
  });
}

const landmarkIcon = L.divIcon({
  className: "",
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  html: `<div style="position:relative;width:44px;height:44px;display:grid;place-items:center">
    <span class="mic-ring" style="background:rgba(139,92,246,.45)"></span>
    <div style="position:relative;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#ec4899);border:2px solid #fff;font-size:15px">🎓</div></div>`,
});

const osmIcon = L.divIcon({
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div class="pin" style="width:14px;height:14px;border-radius:50%;background:#64748b;border:2px solid #cbd5e1"></div>`,
});

/** Fit zoom to the radius circle whenever centre/radius changes. */
function FitToRadius({ center, radius }: { center: { lat: number; lng: number } | null; radius: number }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    const bounds = L.latLng(center.lat, center.lng).toBounds(radius * 2.15);
    map.flyToBounds(bounds, { duration: 0.9, padding: [16, 16] });
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
    <MapContainer center={[fallback.lat, fallback.lng]} zoom={11} className="dark-tiles h-full w-full" zoomControl={false} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitToRadius center={center} radius={radius_m} />
      <FocusSelected hit={hits.find((h) => h.id === selectedId)} />
      {center && (
        <>
          <Circle center={[center.lat, center.lng]} radius={radius_m} pathOptions={{ color: "#a78bfa", weight: 1.5, fillColor: "#8b5cf6", fillOpacity: 0.08, dashArray: "6 6" }} />
          <Marker position={[center.lat, center.lng]} icon={landmarkIcon} zIndexOffset={1000}>
            <Popup>{landmark ?? "Landmark"}</Popup>
          </Marker>
        </>
      )}
      {osm.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={osmIcon}>
          <Popup>
            <b>{p.name}</b>
            <br />
            OpenStreetMap {p.kind.replace("_", " ")} · {(p.distance_m / 1000).toFixed(1)} km
            <br />
            <i>No price info (unverified)</i>
          </Popup>
        </Marker>
      ))}
      {hits.map((h) => {
        const rank = rankOf[h.id];
        return (
          <Marker
            key={h.id}
            position={[h.lat, h.lng]}
            icon={pinIcon(priceColor(h.monthly_rent, budget), rank ? `#${rank}` : "₹", selectedId === h.id)}
            zIndexOffset={rank ? 500 - rank : 0}
            eventHandlers={{ click: () => onSelect(h.id) }}
          >
            <Popup>
              <b>{h.name}</b>
              <br />
              Rs {h.monthly_rent.toLocaleString("en-IN")}/mo · {(h.distance_m / 1000).toFixed(2)} km
              <br />
              <span style={{ color: "#fcd34d" }}>Sample data</span>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
