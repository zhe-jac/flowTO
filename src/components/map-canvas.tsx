"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MapboxCanvas = dynamic(() => import("./mapbox-canvas"), {
  ssr: false,
  loading: () => <p className="map-message" role="status">Loading Mapbox…</p>,
});

const MapLibreCanvas = dynamic(() => import("./maplibre-canvas"), {
  ssr: false,
  loading: () => <p className="map-message" role="status">Loading Toronto map…</p>,
});

export default function MapCanvas() {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  const [showNotice, setShowNotice] = useState(true);

  if (accessToken) return <MapboxCanvas accessToken={accessToken} />;

  return (
    <>
      <MapLibreCanvas />
      {showNotice ? <aside className="map-provider-notice" aria-label="Mapbox setup">
        <button type="button" className="map-provider-dismiss" aria-label="Dismiss Mapbox notice" onClick={() => setShowNotice(false)}>×</button>
        <strong>Mapbox preview needs a public token.</strong>
        <p>The existing map is shown until you set <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> in <code>.env.local</code> and restart the app.</p>
        <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer">Get a Mapbox token</a>
      </aside> : null}
    </>
  );
}
