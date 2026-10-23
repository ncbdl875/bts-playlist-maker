import { createHash } from 'node:crypto';
import { redis, key, cooldownSeconds, registerSpotify429, limited, fixedWindowLimit, clientIp } from '../../../lib/redis';

// Only Spotify tracks listing BTS or one of the seven members as an artist.
const BTS_ARTIST_IDS = new Set([
  '3Nrfpe0tUJi4K4DXYWgMUX', // BTS
  '1oSPZhvZMIrWW5I41kPkkY', // Jimin
  '3JsHnjpbhX4SnySpvpa9DK', // V
  '2auC28zjQyVTsiZKNgPRGs', // RM
  '5vV3bFXnN6D6N3Nj4xRvaV', // Jin
  '6HaGTQPmzraVmaVxvz6EUc', // Jungkook
  '5RmQ8k4l3HZ8JoPb4mNsML', // Agust D
  '0b1sIQumIAsNbqAoIClSpy', // j-hope
]);

let tokenCache: { token: string; until: number } | null = null;
let tokenPromise: Promise<string> | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.token;
  if (!tokenPromise) tokenPromise = (async () => {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) throw new Error('Missing Spotify credentials');
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }), cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Spotify token HTTP ${r.status}`);
    const data = await r.json();
    tokenCache = { token: data.access_token, until: Date.now() + Math.max(60, data.expires_in - 90) * 1000 };
    return tokenCache.token;
  })().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (q.length < 2) return Response.json({ success: true, tracks: [] });
  if (q.length > 100) return Response.json({ success: false, error: 'Từ khóa quá dài' }, { status: 400 });
  const hash = createHash('sha256').update(q).digest('hex');
  const cacheKey = key(`search:bts-only-v4-20:${hash}`);
  const lockKey = key(`search:lock:bts-only-v4-20:${hash}`);
  try {
    const cached = await redis.get<{ success: boolean; tracks: unknown[] }>(cacheKey);
    if (cached) return Response.json(cached, { headers: { 'X-Search-Cache': 'HIT' } });
    const wait = await cooldownSeconds();
    if (wait) return limited('Spotify đang giới hạn API. Vui lòng thử lại sau.', wait);
    const ip = createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 24);
    if (!(await fixedWindowLimit(`search-ip:${ip}`, 20, 60))) return limited('Bạn tìm kiếm quá nhanh.', 60);
    // Shared budget for uncached search operations (each may make up to two Spotify requests).
    if (!(await fixedWindowLimit('search-global', 45, 60))) return limited('Hệ thống đang bận, thử lại sau ít phút.', 60);
    const acquired = await redis.set(lockKey, '1', { nx: true, ex: 15 });
    if (!acquired) {
      for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 350));
        const existing = await redis.get(cacheKey);
        if (existing) return Response.json(existing, { headers: { 'X-Search-Cache': 'HIT' } });
      }
      return limited('Từ khóa đang được xử lý. Vui lòng thử lại.', 2);
    }
    try {
      const token = await accessToken();
      // Spotify Development Mode: maximum 10 results per request.
      // Fetch two consecutive pages (offset 0 and 10), then filter by artist ID.
      const allItems: any[] = [];
      for (const offset of [0, 10]) {
        const url = new URL('https://api.spotify.com/v1/search');
        url.searchParams.set('q', q);
        url.searchParams.set('type', 'track');
        url.searchParams.set('limit', '10');
        url.searchParams.set('offset', String(offset));
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (r.status === 429) {
          const retry = await registerSpotify429(r);
          console.warn('Spotify search 429', { retryAfter: retry });
          return limited('Spotify đã hết hạn mức tìm kiếm tạm thời.', retry);
        }
        if (!r.ok) {
          const errorBody = await r.text();
          console.error('Spotify search failed', r.status, errorBody.slice(0, 500));
          return Response.json({ success: false, error: 'Spotify tạm thời không thể tìm kiếm.' }, { status: 502 });
        }
        const data = await r.json();
        const items = data.tracks?.items || [];
        allItems.push(...items);
        if (items.length < 10 || !data.tracks?.next) break;
      }
      const tracks = allItems.filter((t: any) =>
        t?.id && Array.isArray(t.artists) && t.artists.some((a: any) => BTS_ARTIST_IDS.has(a.id))
      ).map((t: any) => ({
        id: t.id, name: t.name, artists: t.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
        image: t.album?.images?.[0]?.url || '', uri: t.uri, explicit: Boolean(t.explicit),
      }));
      const result = { success: true, total_found: tracks.length, tracks };
      await redis.set(cacheKey, result, { ex: 86400 });
      return Response.json(result, { headers: { 'X-Search-Cache': 'MISS' } });
    } finally {
      await redis.del(lockKey).catch(() => undefined);
    }
  } catch (e) {
    console.error('Search backend unavailable', e);
    return Response.json({ success: false, error: 'Hệ thống tìm kiếm tạm thời không khả dụng.' }, { status: 503 });
  }
}
