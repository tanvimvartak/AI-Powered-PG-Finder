import type { Metadata, Viewport } from "next";
import { Geist_Mono, Outfit } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PG Finder Agent: find a student PG in one sentence",
  description: "Say one sentence and an AI agent finds, ranks and contacts PG owners near your college in India. Free, map-based, voice-enabled.",
};

export const viewport: Viewport = { themeColor: "#0a0a16", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
