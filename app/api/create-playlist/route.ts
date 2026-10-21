import { NextResponse } from 'next/server';

async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Thiếu cấu hình biến môi trường Spotify trong .env.local');
  }

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const title = body.title || `NCBOTDL875 - BTS MIXTAPE (${new Date().toLocaleDateString('vi-VN')})`;
    const description = body.description || 'Tự động tạo bởi hệ thống Mixtape Maker cho BTS & Solo.';
    
    // Nhận trực tiếp mảng URIs đã được xếp theo thứ tự hiển thị
    let uris: string[] = body.trackUris || [];

    // Fallback nếu truyền dạng tracks/selectedTracks
    if (uris.length === 0 && (body.tracks || body.selectedTracks)) {
      const rawTracks = body.tracks || body.selectedTracks;
      rawTracks.forEach((t: any) => {
        const uri = t.uri ? t.uri : `spotify:track:${t.id}`;
        uris.push(uri);
      });
    }

    if (!uris || uris.length === 0) {
      return NextResponse.json({ error: 'Chưa chọn bài hát nào để tạo playlist' }, { status: 400 });
    }

    const accessToken = await getAccessToken();

    // 1. Tạo Playlist mới trên tài khoản Master
    const playlistResponse = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: title,
        description: description,
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

    // 2. Thêm danh sách bài hát GIỮ NGUYÊN THỨ TỰ vào Playlist (Mỗi mẻ tối đa 100 bài)
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
