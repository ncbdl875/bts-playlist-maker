import { createHash, randomUUID } from 'node:crypto';
import { redis, key, cooldownSeconds, registerSpotify429, limited, clientIp } from '../../../lib/redis';

const spotifyUri = /^spotify:track:[a-zA-Z0-9]{22}$/;
const DAY = 86400;
const CACHE_TTL = 30 * DAY;
const PENDING_TTL = 15 * 60;
const GLOBAL_LIMIT = 30;

type PlaylistState =
  | { status: 'pending'; owner: string; at: number }
  | { status: 'partial'; owner: string; url: string; playlistId: string; added: number; at: number }
  | { status: 'complete'; url: string; total_tracks: number; at: number };

async function accessToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error('Thiếu cấu hình Spotify Master');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Spotify refresh token failed (${r.status})`);
  const data = await r.json();
  return data.access_token as string;
}

function responseFromExisting(state: PlaylistState | null, count: number): Response | null {
  if (!state) return null;
  if (state.status === 'complete') {
    return Response.json({ success: true, url: state.url, playlistUrl: state.url, total_tracks: count, reused: true });
  }
  if (state.status === 'partial') {
    return Response.json({ error: 'Playlist đã tạo một phần. Vui lòng liên hệ quản trị viên thay vì tạo lại.', playlistUrl: state.url }, { status: 409 });
  }
  return limited('Playlist tương tự đang được tạo. Vui lòng đợi rồi thử lại.', 15, 409);
}

// Atomic quota check and increment. TTL begins on first accepted NEW playlist attempt.
// We count accepted attempts, including Spotify failures, to prevent repeated abuse.
// Cached playlists bypass this quota entirely.
const quotaScript = `
local ip = tonumber(redis.call('GET', KEYS[1]) or '0')
local session = tonumber(redis.call('GET', KEYS[2]) or '0')
local global = tonumber(redis.call('GET', KEYS[3]) or '0')
if ip >= tonumber(ARGV[1]) then return 1 end
if session >= tonumber(ARGV[2]) then return 2 end
if global >= tonumber(ARGV[3]) then return 3 end
for i=1,3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i+3])) end
end
return 0
`;
// Remove a pending lock only if it is still owned by this request.
const releasePendingScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, value = pcall(cjson.decode, raw)
if ok and value.status == 'pending' and value.owner == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = String(body.title || 'NCBOTDL875 - BTS MIXTAPE').trim().slice(0, 100);
    const description = String(body.description || '').slice(0, 300);
    const raw: unknown = body.uris ?? body.trackUris ??
      (Array.isArray(body.tracks) ? body.tracks : Array.isArray(body.selectedTracks) ? body.selectedTracks : [])
        .map((t: { uri?: string; id?: string }) => t.uri || `spotify:track:${t.id}`);

    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 1000 ||
        !raw.every((uri: unknown) => typeof uri === 'string' && spotifyUri.test(uri))) {
      return Response.json({ error: 'Danh sách bài hát không hợp lệ (tối đa 1000 tracks).' }, { status: 400 });
    }
    const uris: string[] = raw;
    const session = request.headers.get('x-playlist-session') || '';
    if (!/^[a-f0-9-]{36}$/i.test(session)) {
      return Response.json({ error: 'Thiếu phiên tạo playlist hợp lệ.' }, { status: 400 });
    }

     // Canonical multiset: same URI frequencies, regardless of order/title/description.
    const counts = new Map<string, number>();
    for (const uri of uris) counts.set(uri, (counts.get(uri) || 0) + 1);
    const canonical = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const playlistKey = key(`playlist:shared:v1:${fingerprint}`);
    const userHash = createHash('sha256').update(session).digest('hex').slice(0, 32);
    const ipHash = createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 24);

    const existing = await redis.get<PlaylistState>(playlistKey);
    const reused = responseFromExisting(existing, uris.length);
    if (reused) return reused;

    const wait = await cooldownSeconds();
    if (wait) return limited('Spotify đang giới hạn API, vui lòng thử lại sau.', wait);

    const owner = randomUUID();
    const acquired = await redis.set(playlistKey, { status: 'pending', owner, at: Date.now() }, { nx: true, ex: PENDING_TTL });
    if (!acquired) {
      const current = await redis.get<PlaylistState>(playlistKey);
      return responseFromExisting(current, uris.length) || limited('Playlist đang được xử lý.', 15, 409);
    }
 let createdId = '';
    let createdUrl = '';
    try {
      const quotaResult = Number(await redis.eval(quotaScript,
        [key(`limit:create-ip-24h:${ipHash}`), key(`limit:create-session-24h:${userHash}`), key(`limit:create-global-60s:${Math.floor(Date.now() / 60000)}`)],
        [3, 3, GLOBAL_LIMIT, DAY, DAY, 62]));
      if (quotaResult !== 0) {
        await redis.eval(releasePendingScript, [playlistKey], [owner]);
        if (quotaResult === 1) return limited('Mỗi IP chỉ được tạo 3 playlist mới trong 24 giờ.', DAY);
        if (quotaResult === 2) return limited('Mỗi phiên trình duyệt chỉ được tạo 3 playlist mới trong 24 giờ.', DAY);
        return limited('Hệ thống đang bận, vui lòng thử lại sau.', 60);
      }

      const token = await accessToken();
      const created = await fetch('https://api.spotify.com/v1/me/playlists', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title, description, public: false }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (created.status === 429) {
        const seconds = await registerSpotify429(created);
        await redis.eval(releasePendingScript, [playlistKey], [owner]);
        return limited('Spotify giới hạn tạo playlist.', seconds);
      }
      if (!created.ok) {
        await redis.eval(releasePendingScript, [playlistKey], [owner]);
        return Response.json({ error: `Spotify không tạo được playlist (HTTP ${created.status}).` }, { status: 502 });
      }
      const playlist = await created.json();
      if (!playlist?.id || !/^[a-zA-Z0-9]{22}$/.test(playlist.id)) {
        throw new Error('Spotify returned invalid playlist ID');
      }
      createdId = playlist.id;
      createdUrl = playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${createdId}`;
      await redis.set(playlistKey, { status: 'partial', owner, url: createdUrl, playlistId: createdId, added: 0, at: Date.now() }, { ex: CACHE_TTL });

       for (let i = 0; i < uris.length; i += 100) {
        const r = await fetch(`https://api.spotify.com/v1/playlists/${createdId}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        });
        if (r.status === 429) {
          const seconds = await registerSpotify429(r);
          return Response.json({ error: 'Spotify giới hạn khi thêm bài. Playlist đã tạo một phần; không bấm tạo lại.', playlistUrl: createdUrl, retryAfter: seconds }, { status: 429 });
        }
        if (!r.ok) {
          return Response.json({ error: `Không thêm được bài vào playlist (HTTP ${r.status}). Playlist đã tạo một phần.`, playlistUrl: createdUrl }, { status: 502 });
        }
        await redis.set(playlistKey, { status: 'partial', owner, url: createdUrl, playlistId: createdId, added: Math.min(i + 100, uris.length), at: Date.now() }, { ex: CACHE_TTL });
      }
      await redis.set(playlistKey, { status: 'complete', url: createdUrl, total_tracks: uris.length, at: Date.now() }, { ex: CACHE_TTL });
      return Response.json({ success: true, url: createdUrl, playlistUrl: createdUrl, total_tracks: uris.length, reused: false });
    } catch (error) {
      console.error('Spotify playlist creation failed', error);
      if (!createdId) await redis.eval(releasePendingScript, [playlistKey], [owner]).catch(() => undefined);
      return Response.json({ error: createdId ? 'Playlist có thể đã tạo một phần. Vui lòng liên hệ quản trị viên.' : 'Không thể kết nối Spotify.', playlistUrl: createdUrl || undefined }, { status: 502 });
    }
  } catch (error) {
    console.error('Playlist API failed', error);
    return Response.json({ error: 'Dịch vụ tạm thời không khả dụng. Kiểm tra Redis và cấu hình.' }, { status: 503 });
  }
}


