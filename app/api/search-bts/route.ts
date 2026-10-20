import { NextResponse } from 'next/server';

const BTS_ARTIST_IDS = [
  '3Nrfpe0tUJi4K4DXYWgMUX', // BTS
  '1oSPZhvZMIrWW5I41kPkkY', // Jimin
  '3JsHnjpbhX4SnySpvpa9DK', // V
  '2auC28zjQyVTsiZKNgPRGs', // RM
  '5vV3bFXnN6D6N3Nj4xRvaV', // Jin
  '6HaGTQPmzraVmaVxvz6EUc', // Jungkook
  '5RmQ8k4l3HZ8JoPb4mNsML', // Agust D
  '0b1sIQumIAsNbqAoIClSpy'  // j-hope
];

// Biến lưu trữ Cache Token tạm thời trên Server để giảm tải
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken; // Dùng lại token cũ nếu chưa hết hạn
  }

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
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Lỗi cấp quyền Token: ${JSON.stringify(tokenData)}`);
  }

  cachedToken = tokenData.access_token;
  // Trừ hao đi 60 giây trước khi token thực sự hết hạn (expires_in tính bằng giây)
  tokenExpiresAt = now + (tokenData.expires_in - 60) * 1000;

  return cachedToken;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Vui lòng nhập từ khóa tìm kiếm bài hát' }, { status: 400 });
  }

  try {
    const accessToken = await getAccessToken();

    // 🌟 KỸ THUẬT LẤY NHIỀU KẾT QUẢ MÀ KHÔNG LỖI LIMIT:
    // Gọi song song 2 trang: trang 1 (offset 0, limit 10) và trang 2 (offset 10, limit 10) -> tổng cộng 20 kết quả
    const limit = 10;
    const offsets = [0, 20]; // Bạn có thể mở rộng thêm [0, 10, 20] nếu muốn lấy nhiều hơn nữa

    const requests = offsets.map(offset =>
      fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(res => res.json())
    );

    const results = await Promise.all(requests);

    // Gộp tất cả mảng tracks.items từ các trang lại
    let allTracksItems: any[] = [];
    for (const data of results) {
      if (data.tracks && data.tracks.items) {
        allTracksItems = allTracksItems.concat(data.tracks.items);
      }
    }

    // Lọc chỉ giữ lại bài hát có credit của BTS & Thành viên, ĐỒNG THỜI GIỮ NGUYÊN TẤT CẢ CÁC VER (Không loại bỏ trùng lặp ID)
    const filteredTracks = allTracksItems.filter((track: any) =>
      track.artists.some((artist: any) => BTS_ARTIST_IDS.includes(artist.id))
    ).map((track: any) => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a: any) => a.name).join(', '),
      image: track.album.images[0]?.url || '',
      uri: track.uri,
      explicit: track.explicit
    }));

    return NextResponse.json({ success: true, total_found: filteredTracks.length, tracks: filteredTracks });

  } catch (error: any) {
    console.error('Lỗi Server Route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}