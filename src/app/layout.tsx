import type { Metadata } from "next";
import { GlassFilter } from "@/components/glass-filter";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Toronto Traffic Sandbox",
  description: "An interactive street map of Toronto.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><GlassFilter />{children}</body></html>;
}
