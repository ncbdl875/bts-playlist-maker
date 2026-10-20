'use client';
import { useState } from 'react';

type Track = {
  id: string;
  name: string;
  artists: string;
  image: string;
  uri: string;
  explicit: boolean;
};

type SelectedTrack = Track & {
  repeatCount: number;
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<SelectedTrack[]>([]);
  
  const [creating, setCreating] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 1. Tìm kiếm nhạc BTS & Solo qua API nội bộ
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/search-bts?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        setResults(data.tracks);
      } else {
        alert('Lỗi tìm kiếm: ' + (data.error || 'Không xác định'));
      }
    } catch (error) {
      console.error('Lỗi khi tìm kiếm:', error);
      alert('Có lỗi xảy ra khi kết nối tới server tìm kiếm.');
    }
    setLoading(false);
  };

  // 2. Thêm bài hát vào danh sách chờ (Mặc định lặp 5 lần)
  const handleAddTrack = (track: Track) => {
    const existing = selectedTracks.find(t => t.id === track.id);
    if (!existing) {
      setSelectedTracks([...selectedTracks, { ...track, repeatCount: 5 }]);
    }
  };

  // 3. Tăng/giảm số lượng lặp lại (1 - 20)
  const updateRepeatCount = (id: string, delta: number) => {
    setSelectedTracks(prev =>
      prev.map(track => {
        if (track.id === id) {
          const newCount = track.repeatCount + delta;
          if (newCount >= 1 && newCount <= 20) {
            return { ...track, repeatCount: newCount };
          }
        }
        return track;
      })
    );
  };

  // 4. Xóa bài hát khỏi danh sách chờ
  const handleRemoveTrack = (id: string) => {
    setSelectedTracks(prev => prev.filter(track => track.id !== id));
  };

  // 5. Gửi request tạo Playlist tới Backend
  const handleCreatePlaylist = async () => {
    if (selectedTracks.length === 0) return;

    setCreating(true);
    setPlaylistUrl(null);

    try {
      const res = await fetch('/api/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTracks }),
      });

      const data = await res.json();
      if (res.ok && data.url) {
        setPlaylistUrl(data.url);
      } else {
        const detailMsg = data.details ? `\nChi tiết: ${data.details}` : '';
        alert('Lỗi tạo playlist: ' + (data.error || 'Không xác định') + detailMsg);
      }
    } catch (error) {
      console.error('Lỗi kết nối:', error);
      alert('Có lỗi xảy ra khi kết nối tới server.');
    }
    setCreating(false);
  };

  // 6. Sao chép liên kết Playlist
  const handleCopyLink = () => {
    if (playlistUrl) {
      navigator.clipboard.writeText(playlistUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalPlaylistTracks = selectedTracks.reduce((sum, t) => sum + t.repeatCount, 0);

  return (
    <main className="min-h-screen p-6 md:p-12 bg-gray-950 text-white font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* Tiêu đề Web */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-black mb-2 text-purple-400 tracking-wider">
          NHỮNG CON BOT ĐAU LƯNG MIXER
          </h1>
          <p className="text-sm text-gray-400">
            Hệ thống tạo PLAYLIST STREAM SPOTIFY ONLY BTS & 7. 
          </p>
        </div>

        {/* Khung tìm kiếm */}
        <form onSubmit={handleSearch} className="flex gap-3 mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập tên bài hát kèm tên nghệ sĩ (VD: SWIM BTS, WHO JIMIN, LOVE ME AGAIN V...)"
            className="flex-1 p-4 rounded-xl bg-gray-900 border border-purple-600/50 outline-none focus:border-purple-400 text-white placeholder-gray-500 shadow-inner"
          />
          <button 
            type="submit" 
            disabled={loading}
            className="px-8 py-4 bg-purple-600 hover:bg-purple-700 rounded-xl font-bold transition-all shadow-lg shadow-purple-900/40 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Đang tìm...' : 'Tìm kiếm'}
          </button>
        </form>

        {/* Khu vực kết quả và danh sách chọn */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Cột 1: Kết quả tìm kiếm */}
          <div className="bg-gray-900/60 border border-gray-800 p-5 rounded-2xl">
            <h2 className="text-lg font-bold mb-4 text-gray-300 border-b border-gray-800 pb-2 flex justify-between items-center">
              <span>Kết quả tìm kiếm</span>
              <span className="text-xs text-purple-400 font-normal">{results.length} bài hát</span>
            </h2>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {results.map((track) => (
                <div key={track.id} className="flex items-center justify-between p-3 bg-gray-800/80 rounded-xl border border-gray-700/50 hover:border-purple-500/50 transition-all">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <img src={track.image} alt={track.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-bold text-sm truncate">{track.name}</span>
                      <span className="text-xs text-gray-400 truncate">{track.artists}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAddTrack(track)}
                    className="ml-2 px-3.5 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer"
                  >
                    + Thêm
                  </button>
                </div>
              ))}
              {results.length === 0 && !loading && (
                <p className="text-gray-500 text-center py-10 text-sm">Chưa có kết quả tìm kiếm hoặc chưa nhập từ khóa.</p>
              )}
            </div>
          </div>

          {/* Cột 2: Danh sách bài hát chờ tạo Playlist */}
          <div className="bg-gray-900/60 border border-purple-900/30 p-5 rounded-2xl flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-bold mb-4 text-purple-300 border-b border-purple-900/50 pb-2 flex justify-between items-center">
                <span>CÁC TRACKS ĐÃ CHỌN</span>
                <span className="text-xs text-purple-400 font-normal">Tổng: {totalPlaylistTracks} bài</span>
              </h2>
              
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {selectedTracks.map((track) => (
                  <div key={track.id} className="flex items-center justify-between p-3 bg-purple-950/30 rounded-xl border border-purple-900/40">
                    
                    {/* Khu vực hiển thị Ảnh bìa + Tên bài hát */}
                    <div className="flex items-center gap-3 overflow-hidden mr-2">
                      <img src={track.image} alt={track.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-bold text-sm truncate">{track.name}</span>
                        <span className="text-xs text-purple-400 truncate">{track.artists}</span>
                      </div>
                    </div>

                    {/* Nút cộng / trừ số lượng */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center bg-gray-900 border border-purple-800 rounded-full overflow-hidden">
                        <button 
                          onClick={() => updateRepeatCount(track.id, -1)}
                          className="w-7 h-7 flex items-center justify-center font-bold text-gray-300 hover:bg-purple-900 transition-colors cursor-pointer"
                        >
                          -
                        </button>
                        <span className="w-8 text-center font-black text-xs text-purple-300">{track.repeatCount}x</span>
                        <button 
                          onClick={() => updateRepeatCount(track.id, 1)}
                          className="w-7 h-7 flex items-center justify-center font-bold text-gray-300 hover:bg-purple-900 transition-colors cursor-pointer"
                        >
                          +
                        </button>
                      </div>

                      {/* Nút xóa bài */}
                      <button 
                        onClick={() => handleRemoveTrack(track.id)}
                        className="text-gray-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                        title="Xóa bài"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}

                {selectedTracks.length === 0 && (
                  <p className="text-gray-500 text-center py-10 text-sm">Hãy chọn tracks để bắt đầu tạo PLAYLIST.</p>
                )}
              </div>
            </div>

            {/* Nút Tạo Mixtape */}
            <div className="mt-6">
              <button 
                onClick={handleCreatePlaylist}
                disabled={selectedTracks.length === 0 || creating}
                className={`w-full py-4 rounded-xl font-black text-base tracking-wide transition-all shadow-lg cursor-pointer ${
                  selectedTracks.length > 0 && !creating
                    ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/50 hover:scale-[1.01]' 
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
              >
                {creating ? 'ĐỐ SPOTIFY BTS DEBUT NGÀY NÀO...' : 'TẠO PLAYLIST'}
              </button>
            </div>

          </div>
        </div>

        {/* Màn hình hiển thị kết quả sau khi tạo Playlist thành công */}
        {playlistUrl && (
          <div className="mt-8 p-6 bg-purple-950/40 border-2 border-purple-500/60 rounded-2xl text-center space-y-4 animate-fadeIn">
            <h3 className="text-xl font-bold text-green-400">PLAYLIST ĐÃ ĐƯỢC TẠO</h3>
            <p className="text-xs text-gray-300 max-w-md mx-auto">
              Playlist đã được tự động khởi tạo trực tiếp trên tài khoản Spotify chính của hệ thống. Bạn có thể mở hoặc copy link playlist sau đó tự lưu về acc cá nhân:
            </p>
            
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-2">
              <a 
                href={playlistUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full sm:w-auto px-6 py-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                🎧 Open Playlist on Spotify
              </a>

              <button 
                onClick={handleCopyLink}
                className="w-full sm:w-auto px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-xl border border-gray-600 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {copied ? 'COPY' : 'COPY PLAYLIST LINK'}
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}