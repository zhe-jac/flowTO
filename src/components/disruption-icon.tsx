import type { DisruptionKind } from "@/lib/disruptions";

export default function DisruptionIcon({ kind }: { kind: DisruptionKind | "toolbox" | "close" | "arrow" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "toolbox" ? <><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M3 12h18M9 11v3m6-3v3" /></> : null}
      {kind === "closure" ? <><path d="M5 16v5m14-5v5" /><rect x="2" y="6" width="20" height="10" rx="2" /><path d="m3 14 7-7m0 9L20 6m-1 10 3-3" /></> : null}
      {kind === "event" ? <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-9 3v5m-2.5-2.5h5" /></> : null}
      {kind === "accident" ? <><path d="m10.3 3.8-8.1 14A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.7-3.2l-8.1-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v5m0 3h.01" /></> : null}
      {kind === "construction" ? <><path d="m9 3-5 17h16L15 3zM2 21h20M7 10h10M5 16h14" /></> : null}
      {kind === "close" ? <path d="m6 6 12 12M6 18 18 6" /> : null}
      {kind === "arrow" ? <path d="m9 6 6 6-6 6" /> : null}
    </svg>
  );
}
