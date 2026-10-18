import type { Metadata } from "next";
import { GlassFilter } from "@/components/glass-filter";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "flowTO",
  description: "See what road closures, construction, events and weather do to Toronto traffic.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><GlassFilter />{children}</body></html>;
}
