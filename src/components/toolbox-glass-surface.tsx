"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type LiquidGlass from "liquid-glass-react";

const STILL = { x: 0, y: 0 };

export default function ToolboxGlassSurface({ children, variant }: { children: ReactNode; variant: "button" | "panel" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [allowed, setAllowed] = useState(false);
  const [Renderer, setRenderer] = useState<typeof LiquidGlass | null>(null);

  useEffect(() => {
    const transparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast = window.matchMedia("(prefers-contrast: more)");
    const update = () => setAllowed(!transparency.matches && !contrast.matches && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)")));
    update();
    transparency.addEventListener("change", update);
    contrast.addEventListener("change", update);
    return () => {
      transparency.removeEventListener("change", update);
      contrast.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!allowed || Renderer) return;
    let disposed = false;
    void import("liquid-glass-react").then((module) => {
      if (!disposed) setRenderer(() => module.default);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [allowed, Renderer]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const enhanced = allowed && !!Renderer && size.width > 0 && size.height > 0;

  return (
    <div ref={hostRef} className={`toolbox-glass-shell toolbox-glass-${variant}`} data-enhanced={enhanced}>
      {enhanced ? (
        <div className="toolbox-glass-optics" aria-hidden="true" inert>
          <Renderer
            key={`${size.width}:${size.height}`}
            className="toolbox-liquid-lens"
            style={{ position: "absolute", top: "50%", left: "50%", width: size.width, height: size.height }}
            padding="0"
            cornerRadius={variant === "button" ? 17 : 24}
            displacementScale={variant === "button" ? 32 : 42}
            blurAmount={0.125}
            saturation={125}
            aberrationIntensity={0.8}
            elasticity={0}
            globalMousePos={STILL}
            mouseOffset={STILL}
            mode="standard"
          >
            <span />
          </Renderer>
        </div>
      ) : null}
      {children}
    </div>
  );
}
