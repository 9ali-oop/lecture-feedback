/**
 * Simple in-memory rate limiter keyed on the client IP. Adequate for a
 * single-process deployment — if we ever scale horizontally, swap the Map
 * for Redis. Currently only applied to the public POST /join endpoint
 * where spam would silently create guest accounts.
 *
 * Strategy: sliding-window counter. Each IP gets at most `max` successful
 * calls per `windowMs`. 429 with Retry-After otherwise.
 */
import type { Context, Next } from 'hono';

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

// Opportunistic GC so the map doesn't grow unbounded for ephemeral IPs.
let lastSweep = 0;
function gc(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.timestamps.length === 0 || now - b.timestamps[b.timestamps.length - 1] > windowMs * 4) {
      buckets.delete(key);
    }
  }
}

/**
 * @param max      max requests per windowMs
 * @param windowMs rolling window in ms
 */
export function rateLimit(max: number, windowMs: number) {
  return async (c: Context, next: Next) => {
    // Hono sets `c.env.incoming` under @hono/node-server. Fall back to the
    // X-Forwarded-For header if we're ever behind a proxy in prod.
    const xff = c.req.header('x-forwarded-for');
    // Hono's node adapter exposes the underlying IncomingMessage here; the
    // property isn't on the framework's type, so we narrow via `any`.
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const ip =
      (xff && xff.split(',')[0].trim()) ||
      incoming?.socket?.remoteAddress ||
      'unknown';

    const now = Date.now();
    gc(now, windowMs);

    let b = buckets.get(ip);
    if (!b) {
      b = { timestamps: [] };
      buckets.set(ip, b);
    }
    // Drop timestamps outside the window.
    b.timestamps = b.timestamps.filter((t) => now - t < windowMs);
    if (b.timestamps.length >= max) {
      const oldest = b.timestamps[0];
      const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1000);
      c.header('Retry-After', String(Math.max(1, retryAfter)));
      return c.json({ error: 'Too many requests' }, 429);
    }
    b.timestamps.push(now);
    await next();
  };
}
