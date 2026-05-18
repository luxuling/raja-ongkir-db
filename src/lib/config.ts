import type { ExtractConfig } from "@/types/index";
import { type CliOptions, validateCliNumbers } from "@/services/cli";
import { loadTableNames } from "@/lib/tables";
import { numEnv } from "@/lib/util";

export function loadConfig(opts: CliOptions): ExtractConfig {
  const apiKey =
    process.env.RAJAONGKIR_API_KEY ?? process.env.Key ?? process.env.API_KEY ?? "";
  if (!apiKey) {
    console.error("Missing RAJAONGKIR_API_KEY (or Key) in environment.");
    process.exit(1);
  }

  const { maxProvinces, provinceStart, provinceEnd } = validateCliNumbers(opts);

  return {
    apiKey,
    outDir: process.env.OUT_DIR ?? "./sql-out",
    delayMs: numEnv("REQUEST_DELAY_MS", 100),
    batchSize: Math.max(1, numEnv("BATCH_SIZE", 750)),
    maxRetries: Math.max(1, numEnv("MAX_RETRIES", 3)),
    dryRun: Boolean(opts["dry-run"]),
    tables: loadTableNames(),
    maxProvinces,
    provinceStart,
    provinceEnd,
  };
}
