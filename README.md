# Raja Ongkir Destination 

Crawl the [Raja Ongkir Komerce](https://rajaongkir.komerce.id) destination API and emit PostgreSQL `schema.sql` + `seed.sql` for Indonesian provinces, cities/regencies, districts, and sub-districts.

## Requirements

- [Bun](https://bun.sh)
- Raja Ongkir API key (`Key` header)
- PostgreSQL (to load the generated SQL)

## Setup

```bash
bun install
cp .env.example .env
# set RAJAONGKIR_API_KEY in .env
```

## Extract

```bash
bun run extract
```

Outputs (default `./sql-out/`):

| File | Contents |
|------|----------|
| `schema.sql` | DDL for your configured table names |
| `seed.sql` | `TRUNCATE` those tables, then batched `INSERT`s |

Load into Postgres:

```bash
psql "$DATABASE_URL" -f sql-out/schema.sql
psql "$DATABASE_URL" -f sql-out/seed.sql
```

`seed.sql` only truncates the four destination tables (names from env) before inserting.

## Options

```bash
bun run extract -- --dry-run              # smoke test (shallow crawl)
bun run extract -- --max-provinces 2
bun run extract -- --province-start 11 --province-end 11
bun run scripts/extract-raja-ongkir.ts --help
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RAJAONGKIR_API_KEY` | — | API key (required) |
| `OUT_DIR` | `./sql-out` | Output directory |
| `REQUEST_DELAY_MS` | `100` | Delay between API requests |
| `BATCH_SIZE` | `750` | Rows per `INSERT` in `seed.sql` |
| `MAX_RETRIES` | `3` | Retries per failed request |
| `TABLE_PREFIX` | `raja_` | Prefix for default table names |
| `TABLE_PROVINCES` | `{prefix}provinces` | Override province table name |
| `TABLE_CITIES` | `{prefix}cities` | Override city table name |
| `TABLE_DISTRICTS` | `{prefix}districts` | Override district table name |
| `TABLE_SUB_DISTRICTS` | `{prefix}sub_districts` | Override sub-district table name |

## Notes

- Full crawl issues thousands of sequential requests; expect a long run. If you hit rate limits, raise `REQUEST_DELAY_MS`.
- API flow: `province` → `city/:provinceId` → `district/:cityId` → `sub-district/:districtId`.

```bash
bun run typecheck
```
