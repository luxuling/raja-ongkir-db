/**
 * Crawl Raja Ongkir Komerce destination API and emit PostgreSQL schema + seed SQL.
 *
 * Flow: province → GET city/:provinceId → GET district/:cityId → GET sub-district/:districtId
 *
 * Usage:
 *   RAJAONGKIR_API_KEY=... bun run scripts/extract-raja-ongkir.ts
 *   bun run scripts/extract-raja-ongkir.ts --dry-run # first filtered province + shallow subtree
 *   bun run scripts/extract-raja-ongkir.ts --max-provinces 2
 *   bun run scripts/extract-raja-ongkir.ts --province-start 11 --province-end 11
 *
 * Env:
 *   RAJAONGKIR_API_KEY (required) — also accepts Key= for curl parity
 *   OUT_DIR — default ./sql-out
 *   REQUEST_DELAY_MS — default 100
 *   BATCH_SIZE — INSERT rows per statement, default 750
 *   MAX_RETRIES — default 3
 *
 * Load into Postgres:
 *   psql "$DATABASE_URL" -f sql-out/schema.sql
 *   psql "$DATABASE_URL" -f sql-out/seed.sql
 *
 * seed.sql TRUNCATEs only raja_* tables (destructive for those four tables).
 */

import { mkdir } from "node:fs/promises";

const BASE = "https://rajaongkir.komerce.id/api/v1/destination";

type ApiMeta = {
  message?: string;
  code?: number;
  status?: string;
};

type ApiResponse<T> = {
  meta: ApiMeta;
  data: T;
};

type ProvinceRow = { id: number; name: string };
type ChildRow = { id: number; name: string; zip_code: string | number };

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string | boolean> = {};
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
      } else flags.add(key);
    }
  }
  return { opts, flags };
}

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sqlString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  const s = String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

function zipToText(z: string | number | null | undefined): string | null {
  if (z === null || z === undefined) return null;
  return String(z);
}

function batchedInserts(
  table: string,
  cols: string[],
  rows: string[][],
  batchSize: number,
): string {
  if (rows.length === 0) return "";
  const colList = cols.join(", ");
  let out = "";
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk.map((r) => `(${r.join(", ")})`).join(",\n");
    out += `INSERT INTO ${table} (${colList})\nVALUES\n${values};\n\n`;
  }
  return out;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  const argv = process.argv.slice(2);
  const { opts } = parseArgs(argv);
  if (opts.help) {
    console.log(`Usage: bun run scripts/extract-raja-ongkir.ts [options]

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
    process.exit(0);
  }

  const apiKey =
    process.env.RAJAONGKIR_API_KEY ?? process.env.Key ?? process.env.API_KEY ?? "";
  if (!apiKey) {
    console.error("Missing RAJAONGKIR_API_KEY (or Key) in environment.");
    process.exit(1);
  }

  const outDir = process.env.OUT_DIR ?? "./sql-out";
  const delayMs = numEnv("REQUEST_DELAY_MS", 100);
  const batchSize = Math.max(1, numEnv("BATCH_SIZE", 750));
  const maxRetries = Math.max(1, numEnv("MAX_RETRIES", 3));

  const dryRun = Boolean(opts["dry-run"]);
  const maxProvinces = opts["max-provinces"] != null ? Number(opts["max-provinces"]) : undefined;
  const provinceStart =
    opts["province-start"] != null ? Number(opts["province-start"]) : undefined;
  const provinceEnd = opts["province-end"] != null ? Number(opts["province-end"]) : undefined;

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

  await ensureDir(outDir);

  console.log(`Output directory: ${outDir}`);
  console.log(`REQUEST_DELAY_MS=${delayMs}, BATCH_SIZE=${batchSize}, MAX_RETRIES=${maxRetries}`);
  if (dryRun) console.log("Dry run: limiting crawl to a shallow sample.");

  const fetchJson = async <T>(path: string): Promise<T> => {
    const url = `${BASE}${path}`;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await sleep(delayMs);
        const res = await fetch(url, {
          headers: { Key: apiKey },
        });
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(`Non-JSON from ${url}: ${text.slice(0, 200)}`);
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
        }
        const parsed = body as ApiResponse<T>;
        if (parsed?.meta?.status !== "success") {
          throw new Error(
            `API error ${url}: meta=${JSON.stringify(parsed?.meta)}`,
          );
        }
        return parsed.data;
      } catch (e) {
        lastErr = e;
        const backoff = Math.min(10_000, 500 * 2 ** (attempt - 1));
        console.warn(`Attempt ${attempt}/${maxRetries} failed for ${path}: ${e}. Backoff ${backoff}ms`);
        await sleep(backoff);
      }
    }
    console.error(`Giving up on ${path}:`, lastErr);
    throw lastErr;
  };

  console.log("Fetching provinces...");
  const provincesRaw = await fetchJson<ProvinceRow[]>("/province");
  let provinces = [...provincesRaw].sort((a, b) => a.id - b.id);

  if (provinceStart !== undefined) {
    provinces = provinces.filter((p) => p.id >= provinceStart!);
  }
  if (provinceEnd !== undefined) {
    provinces = provinces.filter((p) => p.id <= provinceEnd!);
  }
  if (maxProvinces !== undefined) {
    provinces = provinces.slice(0, maxProvinces);
  }
  if (dryRun && provinces.length > 1) {
    provinces = [provinces[0]!];
    console.log("Dry run: using first province after filters only:", provinces[0]?.id);
  }

  const citiesMap = new Map<number, { province_id: number; name: string; zip_code: string | null }>();
  const districtsMap = new Map<
    number,
    { city_id: number; name: string; zip_code: string | null }
  >();
  const subDistrictMap = new Map<
    number,
    { id: number; district_id: number; name: string; zip_code: string | null }
  >();

  for (let pi = 0; pi < provinces.length; pi++) {
    const prov = provinces[pi]!;
    console.log(`Province ${prov.id} ${prov.name}: fetching cities...`);
    const cities = await fetchJson<ChildRow[]>(`/city/${prov.id}`);
    for (const c of cities) {
      citiesMap.set(c.id, {
        province_id: prov.id,
        name: c.name,
        zip_code: zipToText(c.zip_code),
      });
    }
  }

  const cityEntriesAll = [...citiesMap.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`Cities/regencies collected: ${cityEntriesAll.length}`);

  const cityIdsForDistricts = dryRun
    ? cityEntriesAll.slice(0, 1).map(([id]) => id)
    : cityEntriesAll.map(([id]) => id);

  let cityIdx = 0;
  for (const cityId of cityIdsForDistricts) {
    cityIdx += 1;
    if (
      dryRun ||
      cityIdx % 200 === 0 ||
      cityIdx === cityIdsForDistricts.length ||
      cityIdsForDistricts.length < 30
    ) {
      console.log(`Districts: city ${cityId} (${cityIdx}/${cityIdsForDistricts.length})`);
    }
    const districts = await fetchJson<ChildRow[]>(`/district/${cityId}`);
    for (const d of districts) {
      if (!districtsMap.has(d.id)) {
        districtsMap.set(d.id, {
          city_id: cityId,
          name: d.name,
          zip_code: zipToText(d.zip_code),
        });
      }
    }
  }

  if (!dryRun) {
    const cityDone = new Set(cityIdsForDistricts);
    for (const [cityId] of cityEntriesAll) {
      if (cityDone.has(cityId)) continue;
      const districts = await fetchJson<ChildRow[]>(`/district/${cityId}`);
      for (const d of districts) {
        if (!districtsMap.has(d.id)) {
          districtsMap.set(d.id, {
            city_id: cityId,
            name: d.name,
            zip_code: zipToText(d.zip_code),
          });
        }
      }
    }
  }

  const districtEntriesAll = [...districtsMap.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`Districts collected: ${districtEntriesAll.length}`);

  const districtIdsForSubs = dryRun
    ? districtEntriesAll.slice(0, 1).map(([id]) => id)
    : districtEntriesAll.map(([id]) => id);

  let distIdx = 0;
  for (const distId of districtIdsForSubs) {
    distIdx += 1;
    if (
      dryRun ||
      distIdx % 800 === 0 ||
      distIdx === districtIdsForSubs.length ||
      districtIdsForSubs.length < 50
    ) {
      console.log(`Sub-districts: district ${distId} (${distIdx}/${districtIdsForSubs.length})`);
    }
    const subs = await fetchJson<ChildRow[]>(`/sub-district/${distId}`);
    for (const s of subs) {
      subDistrictMap.set(s.id, {
        id: s.id,
        district_id: distId,
        name: s.name,
        zip_code: zipToText(s.zip_code),
      });
    }
  }

  if (!dryRun) {
    const quick = new Set(districtIdsForSubs);
    for (const distId of districtEntriesAll.map(([id]) => id)) {
      if (quick.has(distId)) continue;
      const subs = await fetchJson<ChildRow[]>(`/sub-district/${distId}`);
      for (const s of subs) {
        subDistrictMap.set(s.id, {
          id: s.id,
          district_id: distId,
          name: s.name,
          zip_code: zipToText(s.zip_code),
        });
      }
    }
  }

  const subDistricts = [...subDistrictMap.values()].sort((a, b) => a.id - b.id);
  console.log(`Sub-districts collected: ${subDistricts.length}`);

  const schemaPath = `${outDir}/schema.sql`;
  const seedPath = `${outDir}/seed.sql`;

  const ddl = `-- Raja Ongkir destination mirror (Komerce API)
-- Generated by scripts/extract-raja-ongkir.ts

CREATE TABLE IF NOT EXISTS raja_provinces (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raja_cities (
  id BIGINT PRIMARY KEY,
  province_id BIGINT NOT NULL REFERENCES raja_provinces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zip_code TEXT
);

CREATE TABLE IF NOT EXISTS raja_districts (
  id BIGINT PRIMARY KEY,
  city_id BIGINT NOT NULL REFERENCES raja_cities (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zip_code TEXT
);

CREATE TABLE IF NOT EXISTS raja_sub_districts (
  id BIGINT PRIMARY KEY,
  district_id BIGINT NOT NULL REFERENCES raja_districts (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zip_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_raja_cities_province ON raja_cities (province_id);
CREATE INDEX IF NOT EXISTS idx_raja_districts_city ON raja_districts (city_id);
CREATE INDEX IF NOT EXISTS idx_raja_sub_districts_district ON raja_sub_districts (district_id);
`;

  await Bun.write(schemaPath, ddl);

  const provinceRows: string[][] = provinces.map((p) => [
    String(p.id),
    sqlString(p.name),
  ]);
  const cityRows: string[][] = cityEntriesAll.map(([id, row]) => [
    String(id),
    String(row.province_id),
    sqlString(row.name),
    row.zip_code == null ? "NULL" : sqlString(row.zip_code),
  ]);
  const districtRowsStr: string[][] = districtEntriesAll.map(([id, row]) => [
    String(id),
    String(row.city_id),
    sqlString(row.name),
    row.zip_code == null ? "NULL" : sqlString(row.zip_code),
  ]);
  const subRowsStr: string[][] = subDistricts.map((s) => [
    String(s.id),
    String(s.district_id),
    sqlString(s.name),
    s.zip_code == null ? "NULL" : sqlString(s.zip_code),
  ]);

  const seedBody =
    `-- Raja Ongkir seed (destructive truncate of raja_* only)\nBEGIN;\n\n` +
    `TRUNCATE raja_sub_districts, raja_districts, raja_cities, raja_provinces RESTART IDENTITY CASCADE;\n\n` +
    batchedInserts("raja_provinces", ["id", "name"], provinceRows, batchSize) +
    batchedInserts(
      "raja_cities",
      ["id", "province_id", "name", "zip_code"],
      cityRows,
      batchSize,
    ) +
    batchedInserts(
      "raja_districts",
      ["id", "city_id", "name", "zip_code"],
      districtRowsStr,
      batchSize,
    ) +
    batchedInserts(
      "raja_sub_districts",
      ["id", "district_id", "name", "zip_code"],
      subRowsStr,
      batchSize,
    ) +
    `COMMIT;\n`;

  await Bun.write(seedPath, seedBody);
  console.log(`Wrote ${schemaPath}`);
  console.log(`Wrote ${seedPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
