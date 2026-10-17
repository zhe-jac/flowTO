"use client";

import { useEffect, useRef } from "react";
import type { WeatherState } from "@/lib/weather";

export default function WeatherPrecipitation({ weather, night }: { weather: WeatherState; night: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef({ ...weather, night });
  current.current = { ...weather, night };
  const active = weather.rain > 0 || weather.snow > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const particles = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), size: 0.5 + Math.random(), phase: Math.random() * Math.PI * 2 }));
    let width = 1, height = 1, frame = 0, last = 0, elapsed = 0;
    const resize = () => {
      width = canvas.clientWidth || 1;
      height = canvas.clientHeight || 1;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    };
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      const seconds = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
      last = now;
      elapsed += seconds;
      const { rain, snow, night } = current.current;
      const area = Math.min(1, Math.max(0.3, width * height / 1000000));
      const rainCount = Math.round(140 * rain / 100 * area);
      const snowCount = Math.round(80 * snow / 100 * area);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.strokeStyle = night ? `rgba(178,211,237,${0.2 + rain / 300})` : `rgba(74,122,161,${0.15 + rain / 350})`;
      context.beginPath();
      for (let index = 0; index < rainCount; index++) {
        const particle = particles[index];
        particle.y = (particle.y + seconds * (350 + rain * 3) * particle.size / height) % 1;
        particle.x = (particle.x + seconds * 45 / width) % 1;
        const length = 8 + rain / 6;
        const x = particle.x * width, y = particle.y * height;
        context.moveTo(x, y);
        context.lineTo(x - length * 0.18, y - length);
      }
      context.stroke();
      context.fillStyle = night ? "rgba(229,242,252,.85)" : "rgba(250,253,255,.95)";
      context.beginPath();
      for (let index = 0; index < snowCount; index++) {
        const particle = particles[140 + index];
        particle.y = (particle.y + seconds * (25 + snow * 0.4) * particle.size / height) % 1;
        particle.x = (particle.x + seconds * (10 + Math.sin(elapsed + particle.phase) * 12) / width + 1) % 1;
        const x = particle.x * width, y = particle.y * height, radius = particle.size * (0.8 + snow / 100);
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fill();
    };
    const update = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!document.hidden && !motion.matches) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", update); motion.removeEventListener("change", update); context.clearRect(0, 0, width, height); };
  }, [active]);

  return <div className="weather-atmosphere" aria-hidden="true" style={{ background: `rgba(122,161,191,${Math.max(weather.rain, weather.snow) / 100 * 0.055})` }}><canvas ref={canvasRef} className="weather-precipitation" /></div>;
}
