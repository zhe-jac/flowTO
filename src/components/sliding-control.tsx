"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export default function SlidingControl({ children, className, label, value }: {
  children: ReactNode;
  className: string;
  label: string;
  value: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const measure = () => {
      const selected = group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (selected) setPosition({ x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    group.querySelectorAll("button").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value]);
  return (
    <div ref={ref} className={`${className} sliding-control`} role="group" aria-label={label} data-measured={!!position}>
      <span aria-hidden="true" className="sliding-control-highlight" style={position ? { transform: `translate(${position.x}px, ${position.y}px)`, width: position.width, height: position.height } : { visibility: "hidden" }} />
      {children}
    </div>
  );
}
