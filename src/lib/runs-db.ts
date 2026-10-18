/**
 * Scenario database on Tiger Data (Timescale Postgres). Each saved run stores its inputs and headline results in
 * `scenario_runs`, and its minute-by-minute baseline-versus-scenario metrics in the `run_metrics` hypertable. A
 * continuous aggregate (`run_metrics_hourly`) rolls those up by hour so runs can be compared across the day.
 *
 * Server-only. Enabled by TIGER_DATABASE_URL (a Postgres connection string, e.g. with sslmode=require). Without it,
 * every function reports that the database is not configured and the app keeps working without saved runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { Pool, type PoolConfig } from "pg";
import type { RunPayload, SavedRun } from "./run-payload";

let pool: Pool | null = null;
let schema: Promise<{ timescale: boolean }> | null = null;

export class DatabaseUnavailable extends Error {}

/**
 * Tiger Cloud services may present either a publicly trusted certificate or one signed by Timescale's own root
 * (ca.timescale.com, which Node does not trust by default, e.g. while a service is provisioning). Trust Node's
 * standard roots plus that root (certs/timescale-ca.pem, or TIGER_CA_PATH) rather than disabling certificate checks.
 */
function tlsConfig(url: string): PoolConfig {
  const parsed = new URL(url);
  const caPath = process.env.TIGER_CA_PATH?.trim() || (parsed.hostname.endsWith(".tsdb.cloud.timescale.com") ? path.join(process.cwd(), "certs/timescale-ca.pem") : "");
  if (!caPath) return { connectionString: url };
  // The explicit ssl option below replaces the URL's sslmode, which pg would otherwise apply over it.
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), ssl: { ca: [...rootCertificates, readFileSync(caPath, "utf8")], rejectUnauthorized: true } };
}

function connection() {
  const url = process.env.TIGER_DATABASE_URL?.trim();
  if (!url) throw new DatabaseUnavailable("Tiger Data is not configured. Set TIGER_DATABASE_URL to save and compare runs.");
  pool ??= new Pool({ ...tlsConfig(url), max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000 });
  return pool;
}

async function ensureSchema() {
  schema ??= (async () => {
    const db = connection();
    let timescale = true;
    try {
      await db.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    } catch {
      timescale = false; // Plain Postgres still works; it just skips the hypertable and continuous aggregate.
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS scenario_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        name text NOT NULL,
        sim_date date NOT NULL,
        start_minute integer NOT NULL,
        end_minute integer NOT NULL,
        weather jsonb NOT NULL,
        disruptions jsonb NOT NULL,
        model_version text NOT NULL,
        data_version text NOT NULL,
        extra_delay_vehicle_hours double precision NOT NULL,
        peak_extra_vehicles double precision NOT NULL,
        peak_minute integer NOT NULL,
        unfinished_trips double precision NOT NULL,
        top_roads jsonb NOT NULL
      )`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS run_metrics (
        time timestamptz NOT NULL,
        run_id uuid NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE,
        baseline_on_network double precision NOT NULL,
        scenario_on_network double precision NOT NULL,
        baseline_delay_vehicle_minutes double precision NOT NULL,
        scenario_delay_vehicle_minutes double precision NOT NULL
      )`);
    await db.query("CREATE INDEX IF NOT EXISTS run_metrics_run_time ON run_metrics (run_id, time)");
    if (timescale) {
      await db.query("SELECT create_hypertable('run_metrics', 'time', if_not_exists => TRUE, migrate_data => TRUE)");
      await db.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS run_metrics_hourly WITH (timescaledb.continuous) AS
        SELECT time_bucket('1 hour', time) AS bucket, run_id,
               avg(scenario_on_network - baseline_on_network) AS extra_on_network,
               max(scenario_delay_vehicle_minutes - baseline_delay_vehicle_minutes) AS extra_delay_vehicle_minutes
        FROM run_metrics GROUP BY bucket, run_id WITH NO DATA`);
      await db.query(`
        SELECT add_continuous_aggregate_policy('run_metrics_hourly', start_offset => NULL, end_offset => NULL,
          schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE)`).catch(() => undefined);
    }
    return { timescale };
  })().catch(error => { schema = null; throw error; });
  return schema;
}

export async function saveRun(run: RunPayload): Promise<string> {
  const db = connection();
  const { timescale } = await ensureSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const s = run.summary;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO scenario_runs (name, sim_date, start_minute, end_minute, weather, disruptions, model_version, data_version,
         extra_delay_vehicle_hours, peak_extra_vehicles, peak_minute, unfinished_trips, top_roads)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [run.name, run.date, Math.round(s.start), Math.round(s.end), JSON.stringify(run.weather), JSON.stringify(run.disruptions), run.modelVersion, run.dataVersion,
        s.extraDelayHours, s.peakExtraVehicles, Math.round(s.peakMinute), s.unfinishedTrips, JSON.stringify(s.topRoads)]);
    const id = inserted.rows[0].id;
    // Simulation minutes count from midnight of the run date in Toronto local time.
    await client.query(
      `INSERT INTO run_metrics (time, run_id, baseline_on_network, scenario_on_network, baseline_delay_vehicle_minutes, scenario_delay_vehicle_minutes)
       SELECT ($1::date + make_interval(mins => p.minute)) AT TIME ZONE 'America/Toronto', $2, p.b_on, p.s_on, p.b_delay, p.s_delay
       FROM unnest($3::int[], $4::float8[], $5::float8[], $6::float8[], $7::float8[]) AS p(minute, b_on, s_on, b_delay, s_delay)`,
      [run.date, id, s.series.map(p => Math.round(p.minute)), s.series.map(p => p.baselineOnNetwork), s.series.map(p => p.scenarioOnNetwork), s.series.map(p => p.baselineDelay), s.series.map(p => p.scenarioDelay)]);
    await client.query("COMMIT");
    if (timescale) await db.query("CALL refresh_continuous_aggregate('run_metrics_hourly', NULL, NULL)").catch(() => undefined);
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listRuns(limit = 20): Promise<SavedRun[]> {
  const db = connection();
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT id, created_at, name, to_char(sim_date, 'YYYY-MM-DD') AS sim_date, start_minute, end_minute,
            jsonb_array_length(disruptions) AS disruption_count, extra_delay_vehicle_hours, peak_extra_vehicles,
            unfinished_trips, top_roads->0->>'name' AS top_road
     FROM scenario_runs ORDER BY created_at DESC LIMIT $1`, [Math.min(100, Math.max(1, limit))]);
  return rows.map(row => ({
    id: row.id, createdAt: row.created_at.toISOString(), name: row.name, date: row.sim_date, start: row.start_minute, end: row.end_minute,
    disruptionCount: Number(row.disruption_count), extraDelayHours: Number(row.extra_delay_vehicle_hours),
    peakExtraVehicles: Number(row.peak_extra_vehicles), unfinishedTrips: Number(row.unfinished_trips), topRoad: row.top_road,
  }));
}

/** Average extra vehicles on the roads by hour of day (Toronto time), across all saved runs. */
export async function hourlyPattern(): Promise<{ hour: number; extraVehicles: number; runs: number }[]> {
  const db = connection();
  const { timescale } = await ensureSchema();
  const source = timescale
    ? "SELECT bucket AS t, run_id, extra_on_network AS extra FROM run_metrics_hourly"
    : "SELECT date_trunc('hour', time) AS t, run_id, avg(scenario_on_network - baseline_on_network) AS extra FROM run_metrics GROUP BY 1, 2";
  const { rows } = await db.query(
    `SELECT extract(hour FROM t AT TIME ZONE 'America/Toronto')::int AS hour, avg(extra) AS extra, count(DISTINCT run_id) AS runs
     FROM (${source}) hourly GROUP BY 1 ORDER BY 1`);
  return rows.map(row => ({ hour: row.hour, extraVehicles: Number(row.extra), runs: Number(row.runs) }));
}
