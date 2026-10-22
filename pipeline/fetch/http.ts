/**
 * Identifies the project to public servers, as their usage policies ask;
 * Overpass rate-limits anonymous clients harder.
 */
export const USER_AGENT = 'CityBuilder/0.1 (+https://github.com/mixalbum/CityBuilder)';

/**
 * fetch() with retries and exponential backoff. Public Overpass and open-data
 * servers regularly return 429/5xx or drop connections under load.
 *
 * Behind an HTTP proxy, run with NODE_USE_ENV_PROXY=1 (Node >= 22.21) so
 * fetch honours HTTPS_PROXY.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 8,
  log: (msg: string) => void = console.log,
): Promise<string> {
  const buf = await fetchBytesWithRetry(url, init, attempts, log);
  return new TextDecoder().decode(buf);
}

/** As fetchWithRetry, returning the raw bytes (for images). */
export async function fetchBytesWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 8,
  log: (msg: string) => void = console.log,
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const wait = 2000 * 2 ** (i - 1);
      log(`retrying in ${wait / 1000}s (${String(lastErr).slice(0, 120)})`);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (init.signal?.aborted) throw new Error('aborted');
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string>) } });
      const body = new Uint8Array(await res.arrayBuffer());
      if (res.ok) return body;
      const text = new TextDecoder().decode(body.slice(0, 2000));
      lastErr = new Error(`HTTP ${res.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
      if (res.status < 500 && res.status !== 429) break; // not worth retrying
    } catch (err) {
      if (init.signal?.aborted) throw new Error('aborted');
      lastErr = err;
    }
  }
  throw lastErr;
}
