export type CliOptions = Record<string, string | boolean>;

export function parseArgs(argv: string[]): { opts: CliOptions } {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts["dry-run"] = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith("--")) {
        opts[key] = n;
        i++;
      }
    }
  }
  return { opts };
}

export function printHelp() {
  console.log(`Usage: bun run extract [options]

Options:
  --dry-run           After filters/--max-provinces: crawl only first province plus
                      first city districts plus first district sub-districts (smoke test)
  --max-provinces N   Limit provinces after sorting by id ascending
  --province-start ID Only include provinces with id >= ID
  --province-end ID   Only include provinces with id <= ID
  --help              Show help

Writes schema.sql and seed.sql into OUT_DIR (default ./sql-out).

PostgreSQL load:
  psql "$DATABASE_URL" -f sql-out/schema.sql
  psql "$DATABASE_URL" -f sql-out/seed.sql

Note: seed.sql TRUNCATEs only the four raja_* tables before inserting.
`);
}

export function validateCliNumbers(opts: CliOptions): {
  maxProvinces?: number;
  provinceStart?: number;
  provinceEnd?: number;
} {
  const maxProvinces =
    opts["max-provinces"] != null ? Number(opts["max-provinces"]) : undefined;
  const provinceStart =
    opts["province-start"] != null ? Number(opts["province-start"]) : undefined;
  const provinceEnd =
    opts["province-end"] != null ? Number(opts["province-end"]) : undefined;

  if (maxProvinces != null && (!Number.isFinite(maxProvinces) || maxProvinces < 1)) {
    console.error("--max-provinces must be a positive number");
    process.exit(1);
  }
  for (const [name, v] of [
    ["province-start", provinceStart],
    ["province-end", provinceEnd],
  ] as const) {
    if (v !== undefined && !Number.isFinite(v)) {
      console.error(`--${name} must be a number`);
      process.exit(1);
    }
  }

  return { maxProvinces, provinceStart, provinceEnd };
}
