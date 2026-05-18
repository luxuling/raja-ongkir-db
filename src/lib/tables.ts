import type { TableNames } from "@/types/index";

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function tableEnv(name: string, fallback: string): string {
  const v = process.env[name];
  const value = v == null || v.trim() === "" ? fallback : v.trim();
  if (!IDENT.test(value)) {
    console.error(
      `${name} must be a valid SQL identifier (letters, numbers, underscore; start with letter or _): got "${value}"`,
    );
    process.exit(1);
  }
  return value;
}

export function loadTableNames(): TableNames {
  const rawPrefix = process.env.TABLE_PREFIX?.trim();
  const prefix = rawPrefix === undefined || rawPrefix === "" ? "raja_" : rawPrefix;

  return {
    provinces: tableEnv("TABLE_PROVINCES", `${prefix}provinces`),
    cities: tableEnv("TABLE_CITIES", `${prefix}cities`),
    districts: tableEnv("TABLE_DISTRICTS", `${prefix}districts`),
    subDistricts: tableEnv("TABLE_SUB_DISTRICTS", `${prefix}sub_districts`),
  };
}
