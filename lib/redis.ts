import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();
export const key = (suffix: string) => `ncbotdl875:v2:${suffix}`;

export async function cooldownSeconds(): Promise<number> {
  const until = await redis.get<number>(key('spotify:cooldown'));
  return Math.max(0, Math.ceil(((Number(until) || 0) - Date.now()) / 1000));
}

export async function registerSpotify429(response: Response): Promise<number> {
  const raw = response.headers.get('retry-after');
  const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : 60;
  const safe = Math.max(1, Math.min(seconds, 86400));
  const until = Date.now() + safe * 1000;
  const current = Number(await redis.get<number>(key('spotify:cooldown'))) || 0;
  if (until > current) await redis.set(key('spotify:cooldown'), until, { ex: safe + 60 });
  return safe;
}

export function limited(message: string, seconds: number, status = 429) {
  return Response.json({ success: false, error: message, retryAfter: seconds }, {
    status, headers: { 'Retry-After': String(Math.max(1, seconds)), 'Cache-Control': 'no-store' },
  });
}

export async function fixedWindowLimit(name: string, limit: number, seconds: number) {
  const k = key(`limit:${name}:${Math.floor(Date.now() / (seconds * 1000))}`);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, seconds + 2);
  return count <= limit;
}

export function clientIp(request: Request) {
  // On Vercel, x-real-ip is populated by the trusted proxy; not a login identity.
  return (request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 80);
}
