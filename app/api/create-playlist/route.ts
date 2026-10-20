import { NextResponse } from 'next/server';

// Ép Next.js không cache Route Handler này

async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Thiếu cấu hình biến môi trường Spotify trong .env.local');
  }

  // Luôn lấy Access Token tươi mới từ Refresh Token trong .env.local
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store'
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Lỗi cấp quyền Token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

// Thuật toán xáo trộn thông minh Fisher-Yates Shuffle
function smartShuffle(array: string[]) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { selectedTracks } = body;

    if (!selectedTracks || !Array.isArray(selectedTracks) || selectedTracks.length === 0) {
      return NextResponse.json({ error: 'Chưa chọn bài hát nào để tạo playlist' }, { status: 400 });
    }

    const accessToken = await getAccessToken();

    // 1. Nhân bản ID bài hát theo số lượng (repeatCount) người dùng chọn
    let rawTrackIds: string[] = [];
    selectedTracks.forEach((track: any) => {
      const count = track.repeatCount || 1;
      for (let i = 0; i < count; i++) {
        rawTrackIds.push(track.id);
      }
    });

    // 2. Thuật toán xáo trộn thông minh
    const shuffledTrackIds = smartShuffle(rawTrackIds);

    // 3. Tạo Playlist mới trực tiếp trên tài khoản Master (/v1/me/playlists)
    const playlistResponse = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `BTS Mixtape - ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`,
        description: 'Tự động tạo bởi hệ thống Mixtape Maker cho BTS & Solo.',
        public: false
      }),
      cache: 'no-store'
    });

    if (!playlistResponse.ok) {
      const errorText = await playlistResponse.text();
      console.error('Lỗi chi tiết từ Spotify API khi tạo Playlist:', errorText);
      return NextResponse.json({ 
        error: 'Lỗi tạo Playlist trên Spotify', 
        details: errorText 
      }, { status: 400 });
    }

    const playlistData = await playlistResponse.json();
    const playlistId = playlistData.id;
    const playlistUrl = playlistData.external_urls.spotify;

    // 4. Thêm bài hát đã xáo trộn vào Playlist (mỗi mẻ tối đa 100 bài)
    const uris = shuffledTrackIds.map(id => `spotify:track:${id}`);
    
    for (let i = 0; i < uris.length; i += 100) {
      const batchUris = uris.slice(i, i + 100);
      const addResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: batchUris }),
        cache: 'no-store'
      });

      if (!addResponse.ok) {
        const errorText = await addResponse.text();
        console.error('Lỗi thêm bài hát vào Playlist:', errorText);
        return NextResponse.json({ 
          error: 'Lỗi thêm bài hát vào Playlist', 
          details: errorText 
        }, { status: 400 });
      }
    }

    return NextResponse.json({ 
      success: true, 
      url: playlistUrl, 
      total_tracks: uris.length 
    });

  } catch (error: any) {
    console.error('Lỗi Server Route Create Playlist:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}