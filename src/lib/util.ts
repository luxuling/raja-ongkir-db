import { mkdir } from "node:fs/promises";

export function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function zipToText(z: string | number | null | undefined): string | null {
  if (z === null || z === undefined) return null;
  return String(z);
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}
