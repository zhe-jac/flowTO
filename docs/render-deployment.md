# Deploy flowTO to Render

The repository includes a `render.yaml` Blueprint for a single Node.js Web Service. It serves the Next.js frontend and API routes together. Simulation workers run within that server process, and polling uses the same service URL.

## Create the service

1. Commit and push the deployment files to the GitHub branch you want to deploy. The Blueprint currently selects `main`.
2. In Render, choose **New → Blueprint**, connect `zhe-jac/htv`, and select the branch containing `render.yaml`.
3. Review the proposed service before creating it. The Blueprint selects Ohio, one instance, Node.js 22, and the `free` compute plan. Free compute provides 0.1 CPU and 512 MB RAM, so simulations may run slowly or exceed the current 45-second worker budget. Start with this plan to test the deployment; a paid upgrade is a separate choice. See [Render pricing](https://render.com/pricing).
4. Supply the prompted environment variables using your existing values:

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public Mapbox token, included in the browser bundle during the build |
   | `GEMINI_API_KEY` | Private server-side assistant key |
   | `GEMINI_MODEL` | The model identifier you currently use successfully |

   Gemini is optional for manual placement and simulation. If you do not need it, remove those entries from the Blueprint before creation or configure them later in the service settings. MapLibre remains available without a Mapbox token. Keys belong in Render's environment settings; `.env.local` stays on your computer.
5. Create the service and wait for the build and health check. Render provides an HTTPS `onrender.com` URL for the web service.

Adding or changing `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` requires a rebuild because Next.js embeds it in the client bundle. If the token has URL restrictions, allow the deployed origin in the Mapbox account settings.

## Runtime settings

The build command installs the pinned pnpm dependencies, including build-time development dependencies, and runs the production build. The start command binds to `0.0.0.0`; Next.js reads Render's `PORT` environment variable.

The native Node service keeps the repository's worker source files and `public/data/` alongside the build. `/api/health` returns 200 only when the worker, engine, traffic data, topology and placement streets are readable. It does not require Gemini, call weather services or start a simulation.

Keep one service instance and one Next.js process. Simulation jobs are held in process memory, so polling another replica would not reliably find them. Redeploying, restarting or crashing the service clears those jobs. The client can resubmit an expired job, but this is not durable background processing. Continuous lookahead and vehicle-state checkpoints remain separate application work.

The browser uses relative `/api` paths, so the shared frontend/backend deployment needs no separate API URL or cross-origin configuration. The current map and simulation do not require a database or persistent disk.

## Verify the deployment

Open `/api/health` on the deployed domain and confirm it returns `{"status":"ok"}`. Then open the app, add a disruption, wait for processing, press Play, and rewind through the calculated period. Check that markers expire at their scheduled end. If Gemini is configured, test a street-to-street placement prompt.

Check the Render logs and CPU/memory metrics during simulation. If requests fail, distinguish missing files, worker processing timeouts, and memory exhaustion before increasing concurrency or changing the traffic calculations.

## Manual Web Service setup

If you create a Web Service instead of a Blueprint, use:

| Setting | Value |
|---|---|
| Runtime | Node |
| Compute plan | Free |
| Branch | `main` |
| Build command | `corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build` |
| Start command | `corepack pnpm start --hostname 0.0.0.0` |
| Health check path | `/api/health` |
| Instances | `1` |
| Environment | `NODE_VERSION=22`, `NODE_ENV=production`, plus the keys above |

Render's free web services sleep after 15 minutes without inbound traffic and have limited compute. See [the free-service limitations](https://render.com/docs/free), [Blueprint reference](https://render.com/docs/blueprint-spec), and [Next.js deployment guide](https://render.com/docs/deploy-nextjs-app).
