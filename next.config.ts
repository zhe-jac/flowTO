import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  agentRules: false,
  outputFileTracingIncludes: { "/api/traffic/simulations": ["./src/lib/traffic/simulation-worker.mjs", "./src/lib/traffic/simulation-engine.mjs", "./public/data/traffic-topology.json"] },
};

export default config;
