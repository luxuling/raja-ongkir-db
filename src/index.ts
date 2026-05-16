import { createApiClient } from "@/services/api";
import { parseArgs, printHelp } from "@/services/cli";
import { crawlDestinations } from "@/services/crawl";
import { writeSqlFiles } from "@/services/sql";
import { loadConfig } from "@/lib/config";
import { ensureDir } from "@/lib/util";

async function main() {
  const { opts } = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const config = loadConfig(opts);
  await ensureDir(config.outDir);

  console.log(`Output directory: ${config.outDir}`);
  console.log(
    `REQUEST_DELAY_MS=${config.delayMs}, BATCH_SIZE=${config.batchSize}, MAX_RETRIES=${config.maxRetries}`,
  );
  if (config.dryRun) console.log("Dry run: limiting crawl to a shallow sample.");

  const api = createApiClient({
    apiKey: config.apiKey,
    delayMs: config.delayMs,
    maxRetries: config.maxRetries,
  });

  console.log("\nStarting destination crawl…\n");

  const data = await crawlDestinations(api, config);

  console.log("\nWriting SQL files…");
  const { schemaPath, seedPath } = await writeSqlFiles(
    config.outDir,
    data,
    config.batchSize,
  );

  console.log(`Wrote ${schemaPath}`);
  console.log(`Wrote ${seedPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
