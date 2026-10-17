"use client";

import { useEffect, useRef } from "react";
import type { WeatherState } from "@/lib/weather";
import type { DisruptionMap } from "@/lib/disruption-map";
import { lightningEnvelope, lightningPattern, nextLightningTime, stormStrength, weatherDepth } from "@/lib/weather-motion";

export default function WeatherPrecipitation({ map, weather, night }: { map: Pick<DisruptionMap, "getPitch">; weather: WeatherState; night: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastStrike = useRef(-Infinity);
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
    let nextLightning = 0;
    let lightningStarted = -Infinity;
    let pattern = lightningPattern(1, 0.5);
    let bolt: { x: number; y: number }[] = [];
    let flash: CanvasGradient | null = null;
    let haze: CanvasGradient | null = null;
    const resetLightning = () => { nextLightning = 0; lightningStarted = -Infinity; bolt = []; flash = null; };
    const resize = () => {
      width = canvas.clientWidth || 1;
      height = canvas.clientHeight || 1;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      haze = context.createLinearGradient(0, 0, 0, height * 0.72);
      haze.addColorStop(0, "rgba(38,65,92,.19)");
      haze.addColorStop(1, "rgba(38,65,92,0)");
      resetLightning();
    };
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      const seconds = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
      last = now;
      elapsed += seconds;
      const { rain, snow, night } = current.current;
      const depth = weatherDepth(map.getPitch());
      const storm = stormStrength(rain);
      const area = Math.min(1, Math.max(0.3, width * height / 1000000));
      const rainCount = Math.round(140 * rain / 100 * area);
      const snowCount = Math.round(80 * snow / 100 * area);
      context.clearRect(0, 0, width, height);
      if (depth > 0 && haze) {
        context.globalAlpha = depth * Math.max(rain, snow) / 100;
        context.fillStyle = haze;
        context.fillRect(0, 0, width, height);
        context.globalAlpha = 1;
      }
      const layers = depth > 0 ? 3 : 1;
      for (let layer = 0; layer < layers; layer++) {
        const proximity = layers === 1 ? 0 : layer / 2;
        const perspective = 1 + depth * (proximity * 1.4 - 0.25);
        context.lineWidth = 1 + depth * proximity * 0.8;
        const rainAlpha = Math.min(0.85, (night ? 0.2 + rain / 300 : 0.15 + rain / 350) + depth * (0.1 + proximity * 0.15));
        context.strokeStyle = night ? `rgba(${178 + depth * 7},${211 + depth * 7},${237 + depth * 7},${rainAlpha})` : `rgba(74,122,161,${rainAlpha})`;
        context.beginPath();
        for (let index = layer; index < rainCount; index += layers) {
          const particle = particles[index];
          particle.y = (particle.y + seconds * (350 + rain * 3) * particle.size * perspective / height) % 1;
          particle.x = (particle.x + seconds * (45 + depth * (60 + rain * 0.5)) * perspective / width) % 1;
          const length = (8 + rain / 6) * (1 + depth * (0.6 + proximity * 0.8));
          const x = particle.x * width, y = particle.y * height;
          context.moveTo(x, y);
          context.lineTo(x - length * (0.18 + depth * 0.16), y - length);
        }
        context.stroke();
        context.fillStyle = night ? `rgba(229,242,252,${0.85 - depth * (1 - proximity) * 0.25})` : `rgba(250,253,255,${0.95 - depth * (1 - proximity) * 0.25})`;
        context.beginPath();
        for (let index = layer; index < snowCount; index += layers) {
          const particle = particles[140 + index];
          particle.y = (particle.y + seconds * (25 + snow * 0.4) * particle.size * perspective / height) % 1;
          particle.x = (particle.x + seconds * (10 + depth * 20 + Math.sin(elapsed * (1 + depth * 0.5) + particle.phase) * (12 + depth * 22)) * perspective / width + 1) % 1;
          const x = particle.x * width, y = particle.y * height;
          const radius = Math.min(4.5, particle.size * (0.8 + snow / 100) * (1 + depth * (proximity * 1.5 - 0.3)));
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
        context.fill();
      }
      if (storm <= 0 || depth <= 0) {
        if (nextLightning || bolt.length) resetLightning();
      }
      else {
        if (!nextLightning) nextLightning = nextLightningTime(now, lastStrike.current, storm, Math.random(), true);
        if (now >= nextLightning) {
          lightningStarted = now;
          pattern = lightningPattern(Math.random(), Math.random());
          lastStrike.current = now;
          nextLightning = nextLightningTime(now, lastStrike.current, storm, Math.random());
          const startX = width * (0.42 + Math.random() * 0.36);
          const reach = Math.min(height * 0.52, 430);
          bolt = Array.from({ length: 11 }, (_, index) => ({ x: startX + (Math.random() - 0.5) * Math.min(90, width * 0.13) + index * 2, y: -12 + reach * index / 10 }));
          flash = context.createRadialGradient(startX, 0, 0, startX, 0, Math.min(width * 0.65, 620));
          flash.addColorStop(0, "rgba(255,255,255,.62)");
          flash.addColorStop(0.4, "rgba(255,255,255,.24)");
          flash.addColorStop(1, "rgba(255,255,255,0)");
        }
        const pulse = lightningEnvelope(now - lightningStarted, pattern) * (0.65 + storm * 0.35) * depth;
        if (pulse > 0 && flash && bolt.length) {
          context.globalAlpha = pulse;
          context.fillStyle = "rgba(255,255,255,.38)";
          context.fillRect(0, 0, width, height);
          context.fillStyle = flash;
          context.fillRect(0, 0, width, height);
          context.beginPath();
          bolt.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
          const branch = bolt[5];
          context.moveTo(branch.x, branch.y);
          context.lineTo(branch.x - 18, branch.y + 22);
          context.lineTo(branch.x - 10, branch.y + 37);
          context.lineTo(branch.x - 32, branch.y + 57);
          context.lineJoin = "round";
          context.lineCap = "round";
          context.lineWidth = 28;
          context.strokeStyle = "rgba(255,255,255,.05)";
          context.stroke();
          context.lineWidth = 14;
          context.strokeStyle = "rgba(255,255,255,.14)";
          context.stroke();
          context.lineWidth = 7;
          context.strokeStyle = "rgba(255,255,255,.35)";
          context.stroke();
          context.lineWidth = 2.6;
          context.strokeStyle = "#ffffff";
          context.stroke();
          context.globalAlpha = 1;
          context.lineCap = "butt";
          context.lineJoin = "miter";
        }
      }
    };
    const update = () => {
      cancelAnimationFrame(frame);
      last = 0;
      resetLightning();
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
  }, [active, map]);

  return <div className="weather-atmosphere" aria-hidden="true" style={{ background: `rgba(122,161,191,${Math.max(weather.rain, weather.snow) / 100 * 0.055})` }}><canvas ref={canvasRef} className="weather-precipitation" /></div>;
}
