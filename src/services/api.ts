import { API_BASE } from "@/lib/constants";
import type { ApiResponse } from "@/types/index";
import { sleep } from "@/lib/util";

export type ApiClient = {
  fetchJson: <T>(path: string) => Promise<T>;
};

export function createApiClient(options: {
  apiKey: string;
  delayMs: number;
  maxRetries: number;
}): ApiClient {
  const { apiKey, delayMs, maxRetries } = options;

  async function fetchJson<T>(path: string): Promise<T> {
    const url = `${API_BASE}${path}`;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await sleep(delayMs);
        const res = await fetch(url, { headers: { Key: apiKey } });
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
          throw new Error(`API error ${url}: meta=${JSON.stringify(parsed?.meta)}`);
        }
        return parsed.data;
      } catch (e) {
        lastErr = e;
        const backoff = Math.min(10_000, 500 * 2 ** (attempt - 1));
        console.warn(
          `Attempt ${attempt}/${maxRetries} failed for ${path}: ${e}. Backoff ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    console.error(`Giving up on ${path}:`, lastErr);
    throw lastErr;
  }

  return { fetchJson };
}
