// Dedicated entry point for the LightChoice Radar maintenance worker.
// Sets RADAR_WORKER_SCOPE="maintenance" before main.ts evaluates its scopes.
process.env.RADAR_WORKER_SCOPE = "maintenance";
process.env.COLLECT_ENABLED = "false";
if (!process.env.RADAR_PG_BIN) {
  process.env.RADAR_PG_BIN = "D:\\Workspace\\LightChoiceRadarRuntime\\postgresql-17.11\\pgsql\\bin";
}

await import("./main.ts");
