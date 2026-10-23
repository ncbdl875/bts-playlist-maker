'use client';

import { useState, useEffect, useRef } from 'react';

// =====================================================================
// 🎨 BẢNG CẤU HÌNH GIAO DIỆN CHUẨN MÀU LIGHT LAVENDER (MATCH NCBOTDL875.STREAM)
// =====================================================================
const THEME = {
  bgWeb: "bg-gradient-to-br from-[#e9d5ff] via-[#f3e8ff] to-[#d8b4fe]",
  textAccent: "text-[#6b21a8]", 
  textTitle: "text-transparent bg-clip-text bg-gradient-to-r from-[#4c1d95] via-[#7e22ce] to-[#d97706]",
  btnPrimary: "bg-[#7e22ce] hover:bg-[#6b21a8] text-white font-extrabold shadow-[0_8px_20px_rgba(126,34,206,0.3)] rounded-full transition-all active:scale-95",
  btnSpotify: "bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold shadow-[0_8px_20px_rgba(29,185,84,0.3)] rounded-full transition-all active:scale-95",
  glassBox: "bg-white/70 backdrop-blur-2xl border border-purple-300/60 shadow-[0_10px_30px_rgba(112,26,117,0.1)] rounded-3xl",
  trackItem: "bg-white/80 hover:bg-white border border-purple-200/80 hover:border-purple-400 transition-all rounded-2xl shadow-sm",
  counterBtn: "bg-purple-100 hover:bg-purple-300 text-purple-900 w-8 h-8 rounded-full flex items-center justify-center font-bold transition-colors cursor-pointer border border-purple-300",
};

type Track = {
  id: string;
  name: string;
  artists: string;
  image: string;
  uri: string;
  explicit?: boolean;
};

type SelectedTrack = Track & {
  repeatCount: number;
};

type PreviewTrack = Track & {
  instanceId: string;
};

const clientSearchCache = new Map<string, Track[]>();

export default function Home() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [selectedTracks, setSelectedTracks] = useState<SelectedTrack[]>([]);

  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('NCBOTDL875 - BTSTREAM');
  const [playlistDescription, setPlaylistDescription] = useState('Bạn có thể chỉnh mô tả playlist tại đây');
  const [previewList, setPreviewList] = useState<PreviewTrack[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [creating, setCreating] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

 // 1. LIVE SEARCH CÓ DEBOUNCE CACHE + ANTI-RATE LIMIT
  useEffect(() => {
    const cleanQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
    setSearchError('');

    if (!cleanQuery || cleanQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      setIsSearching(false);
      return;
    }

    if (clientSearchCache.has(cleanQuery)) {
      const cachedData = clientSearchCache.get(cleanQuery) || [];
      setSearchResults(cachedData);
      setShowDropdown(true);
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search-bts?q=${encodeURIComponent(cleanQuery)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        
        // NẾU API BÁO LỖI (Ví dụ 429), DỪNG LẠI KHÔNG LƯU CACHE MẢNG RỖNG
        if (!res.ok || data.success === false) {
          setSearchResults([]);
          setSearchError(data.error || 'Không thể tìm kiếm lúc này.');
          setShowDropdown(true);
          return; 
        }

        const rawTracks = data.tracks || [];
        const formattedTracks: Track[] = rawTracks.map((t: any) => ({
          id: t.id || String(Math.random()),
          name: t.name || 'Unknown Track',
          artists: typeof t.artists === 'string' ? t.artists : 'BTS',
          image: typeof t.image === 'string' ? t.image : '',
          uri: t.uri || `spotify:track:${t.id}`,
        }));

        clientSearchCache.set(cleanQuery, formattedTracks);
        if (clientSearchCache.size > 100) clientSearchCache.delete(clientSearchCache.keys().next().value!);
        
        setSearchResults(formattedTracks);
        setShowDropdown(true);
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Lỗi tìm kiếm live:', error);
        }
      } finally {
        setIsSearching(false);
      }
    }, 750);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectTrack = (track: Track) => {
    const existing = selectedTracks.find((t) => t.id === track.id);
    if (!existing) {
      setSelectedTracks([...selectedTracks, { ...track, repeatCount: 5 }]);
    }
    setQuery('');
    setShowDropdown(false);
  };

  const updateRepeatCount = (id: string, delta: number) => {
    setSelectedTracks((prev) =>
      prev.map((track) => {
        if (track.id === id) {
          const newCount = track.repeatCount + delta;
          if (newCount >= 1 && newCount <= 50) {
            return { ...track, repeatCount: newCount };
          }
        }
        return track;
      })
    );
  };

  const handleRemoveTrack = (id: string) => {
    setSelectedTracks((prev) => prev.filter((t) => t.id !== id));
  };

  // 2. SMART SHUFFLE ALGORITHM
  const generateSmartShuffle = () => {
    if (selectedTracks.length === 0) return;

    let expanded: Track[] = [];
    selectedTracks.forEach((item) => {
      for (let i = 0; i < item.repeatCount; i++) {
        expanded.push({ ...item });
      }
    });

    let pool = [...expanded];
    let result: Track[] = [];
    let lastTrackId = '';

    while (pool.length > 0) {
      let candidates = pool.filter((t) => t.id !== lastTrackId);

      if (candidates.length === 0) {
        candidates = pool;
      }

      const randomIndex = Math.floor(Math.random() * candidates.length);
      const chosenTrack = candidates[randomIndex];

      result.push(chosenTrack);
      lastTrackId = chosenTrack.id;

      const indexInPool = pool.findIndex((t) => t === chosenTrack);
      if (indexInPool > -1) {
        pool.splice(indexInPool, 1);
      }
    }

    const formattedPreviewList: PreviewTrack[] = result.map((track, idx) => ({
      ...track,
      instanceId: `${track.id}-${idx}-${Date.now()}-${Math.random()}`
    }));

    setPreviewList(formattedPreviewList);
    setIsPreviewMode(true);
  };

  // 3. DRAG AND DROP
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updatedList = Array.from(previewList);
    const [draggedItem] = updatedList.splice(draggedIndex, 1);
    updatedList.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    setPreviewList(updatedList);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleRemovePreviewTrack = (index: number) => {
    setPreviewList((prev) => prev.filter((_, i) => i !== index));
  };

  // 4. XUẤT PLAYLIST
  const handleConfirmExport = async () => {
    if (previewList.length === 0) return;

    if (creating) return;
    setCreating(true);
    setPlaylistUrl(null);

    const uris = previewList.map(t => t.uri ? t.uri : `spotify:track:${t.id}`);

    try {
      let playlistSession = sessionStorage.getItem('ncbotdl875-playlist-session');
      if (!playlistSession) {
        playlistSession = crypto.randomUUID();
        sessionStorage.setItem('ncbotdl875-playlist-session', playlistSession);
      }
      const res = await fetch('/api/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-playlist-session': playlistSession },
        body: JSON.stringify({
          title: playlistTitle,
          description: playlistDescription,
          uris: uris,
        }),
      });

      const data = await res.json();
      if (res.ok && (data.playlistUrl || data.url)) {
        setPlaylistUrl(data.playlistUrl || data.url);
      } else {
        const detailMsg = data.error || data.details || 'Không xác định';
        alert('Lỗi tạo playlist: ' + detailMsg);
      }
    } catch (error) {
      console.error('Lỗi kết nối:', error);
      alert('Có lỗi xảy ra khi kết nối tới server.');
    }
    setCreating(false);
  };

  const handleCopyLink = () => {
    if (playlistUrl) {
      navigator.clipboard.writeText(playlistUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalTracksCount = selectedTracks.reduce((sum, t) => sum + t.repeatCount, 0);

  return (
    <main className={`min-h-screen p-4 md:p-10 font-sans text-gray-800 ${THEME.bgWeb}`}>
      <div className="max-w-5xl mx-auto space-y-8">
        
        <div className="text-center pt-2 pb-4">
          <div className="inline-block px-6 py-2 rounded-full bg-purple-900/10 text-purple-900 font-extrabold text-xs md:text-sm mb-3 border border-purple-300">
            STREAMING SUPPORT ONLY BTS & 7
          </div>
          <h1 className={`text-3xl md:text-5xl font-black mb-2 tracking-tight drop-shadow-sm ${THEME.textTitle}`}>
            NHỮNG CON BOT ĐAU LƯNG MIX
          </h1>
          <p className="text-xs md:text-base text-purple-900/80 font-bold">
            Tạo Playlist Spotify tự động only các bài hát có credit BTS và 7 thành viên.
          </p>
        </div>

        {/* SEARCH BOX */}
        <div className="relative z-50 max-w-3xl mx-auto" ref={searchRef}>
          <div className={`${THEME.glassBox} p-2 flex items-center shadow-lg`}>
            <span className="pl-4 text-purple-600 text-xl">🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => query.trim().length >= 2 && setShowDropdown(true)}
              placeholder="Nhập tên bài hát (VD: SWIM, WHO, Seven...)"
              className="w-full p-4 bg-transparent outline-none text-purple-950 font-bold placeholder-purple-400 text-sm md:text-base"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="px-3 text-purple-400 hover:text-purple-700 font-bold text-sm"
              >
                ✕
              </button>
            )}
          </div>

          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-2xl border border-purple-300 rounded-3xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto custom-scrollbar z-50">
              {isSearching ? (
                <div className="p-4 text-center text-purple-600 font-bold text-sm animate-pulse">
                  Đang tìm bài hát BTS...
                </div>
              ) : searchError ? (
                <div className="p-4 text-center text-red-600 font-bold text-sm">{searchError}</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((track) => (
                  <div
                    key={track.id}
                    onClick={() => handleSelectTrack(track)}
                    className="flex items-center justify-between p-3.5 hover:bg-purple-100/70 cursor-pointer border-b border-purple-100 transition-colors"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <img src={track.image} alt={track.name} className="w-12 h-12 rounded-xl object-cover shadow-sm shrink-0" />
                      <div className="flex flex-col truncate">
                        <span className="font-extrabold text-purple-950 text-sm truncate">{track.name}</span>
                        <span className="text-xs font-semibold text-purple-600 truncate">{track.artists}</span>
                      </div>
                    </div>
                    <span className="text-xs bg-purple-600 text-white font-bold px-3 py-1.5 rounded-full shrink-0">
                      + Chọn bài
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-purple-500 font-medium text-sm">
                  Không tìm thấy kết quả phù hợp.
                </div>
              )}
            </div>
          )}
        </div>

        {!isPreviewMode ? (
          <div className={`${THEME.glassBox} p-6 md:p-8 relative`}>
            <div className="flex justify-between items-center border-b border-purple-200 pb-4 mb-6">
              <h2 className="text-xl md:text-2xl font-black text-purple-950 flex items-center gap-2">
                💿 CÁC TRACKS ĐÃ CHỌN
              </h2>
              <span className="px-4 py-1.5 rounded-full bg-purple-200/60 text-purple-900 font-black text-sm">
                Tổng: {totalTracksCount} tracks
              </span>
            </div>

            {selectedTracks.length > 0 ? (
              <div className="space-y-3 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                {selectedTracks.map((track) => (
                  <div key={track.id} className={`flex items-center justify-between p-3.5 ${THEME.trackItem}`}>
                    <div className="flex items-center gap-3.5 overflow-hidden">
                      <img src={track.image} alt={track.name} className="w-12 h-12 rounded-xl object-cover shadow-sm shrink-0" />
                      <div className="flex flex-col truncate">
                        <span className="font-extrabold text-purple-950 text-sm truncate">{track.name}</span>
                        <span className="text-xs font-bold text-purple-600 truncate">{track.artists}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center bg-purple-50 rounded-full border border-purple-200 p-1">
                        <button onClick={() => updateRepeatCount(track.id, -1)} className={THEME.counterBtn}>-</button>
                        <span className="w-10 text-center font-black text-sm text-purple-950">{track.repeatCount}x</span>
                        <button onClick={() => updateRepeatCount(track.id, 1)} className={THEME.counterBtn}>+</button>
                      </div>

                      <button onClick={() => handleRemoveTrack(track.id)} className="p-2 text-purple-400 hover:text-red-500 transition-colors">🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-purple-400 font-bold text-sm">
                Chưa có bài hát nào được chọn.
              </div>
            )}

            <div className="mt-8 pt-4 border-t border-purple-200/60">
              <button
                onClick={generateSmartShuffle}
                disabled={selectedTracks.length === 0}
                className={`w-full py-4 font-black text-base md:text-lg tracking-wide ${
                  selectedTracks.length > 0
                    ? THEME.btnPrimary
                    : 'bg-purple-200 text-purple-400 cursor-not-allowed rounded-full'
                }`}
              >
                TẠO & XEM TRƯỚC PLAYLIST
              </button>
            </div>
          </div>
        ) : (
          <div className={`${THEME.glassBox} p-6 md:p-8 animate-fadeIn`}>
            <div className="flex justify-between items-center border-b border-purple-200 pb-4 mb-6">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-purple-950">
                  TÙY CHỈNH TRƯỚC KHI TẠO
                </h2>
                <p className="text-xs text-purple-700 font-semibold mt-1">
                  Kéo thả từng bài hát để thay đổi thứ tự trực tiếp trước khi xuất lên Spotify.
                </p>
              </div>
              <button
                onClick={() => setIsPreviewMode(false)}
                className="px-4 py-2 rounded-full bg-purple-200/70 hover:bg-purple-300 text-purple-950 font-extrabold text-xs transition-colors"
              >
                Sửa bài / Số lần lặp
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-black text-purple-900 mb-1.5 uppercase">Tên Playlist:</label>
                <input
                  type="text"
                  value={playlistTitle}
                  onChange={(e) => setPlaylistTitle(e.target.value)}
                  className="w-full p-3.5 rounded-2xl bg-white border border-purple-300 outline-none focus:border-purple-600 font-bold text-purple-950 text-sm shadow-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-purple-900 mb-1.5 uppercase">Mô tả Playlist:</label>
                <input
                  type="text"
                  value={playlistDescription}
                  onChange={(e) => setPlaylistDescription(e.target.value)}
                  className="w-full p-3.5 rounded-2xl bg-white border border-purple-300 outline-none focus:border-purple-600 font-bold text-purple-950 text-sm shadow-sm"
                />
              </div>
            </div>

            {/* PREVIEW CONTAINER WITH DRAG AND DROP */}
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar bg-purple-950/5 p-3 rounded-2xl border border-purple-200/60 mb-6">
              {previewList.map((track, index) => (
                <div
                  key={track.instanceId}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-grab active:cursor-grabbing ${
                    draggedIndex === index
                      ? 'bg-purple-200 border-purple-500 scale-[0.99] opacity-80'
                      : 'bg-white border-purple-200/80 hover:border-purple-400'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="w-7 text-center font-black text-purple-400 text-xs font-mono">
                      {index + 1}
                    </span>
                    <span className="text-purple-400 text-sm">⣿</span>
                    <img src={track.image} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    <div className="flex flex-col truncate">
                      <span className="font-extrabold text-purple-950 text-xs md:text-sm truncate">{track.name}</span>
                      <span className="text-[11px] font-bold text-purple-600 truncate">{track.artists}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRemovePreviewTrack(index)}
                    className="text-xs text-purple-400 hover:text-red-500 p-1 font-bold"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleConfirmExport}
              disabled={creating || previewList.length === 0}
              className={`w-full py-4 text-base md:text-lg font-black tracking-wide ${THEME.btnSpotify} ${
                creating ? 'opacity-50 cursor-wait' : ''
              }`}
            >
              {creating ? 'ĐANG TẠO PLAYLIST VUI LÒNG ĐỢI...' : 'XÁC NHẬN & XUẤT LÊN SPOTIFY'}
            </button>
          </div>
        )}

        {playlistUrl && (
          <div className={`${THEME.glassBox} p-8 text-center border-2 border-emerald-400/80 shadow-xl animate-fadeIn`}>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 font-bold text-2xl mb-3">
              🎉
            </div>
            <h3 className="text-2xl font-black text-purple-950 mb-2">TẠO PLAYLIST THÀNH CÔNG!</h3>
            <p className="text-sm font-semibold text-purple-800 max-w-lg mx-auto mb-6">
              Playlist đã được tạo. Bạn có thể mở ngay hoặc copy liên kết:
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <a href={playlistUrl} target="_blank" rel="noopener noreferrer" className={`w-full sm:w-auto px-8 py-3.5 flex items-center justify-center gap-2 ${THEME.btnSpotify}`}>
                🎧 MỞ TRÊN SPOTIFY
              </a>
              <button onClick={handleCopyLink} className="w-full sm:w-auto px-8 py-3.5 bg-purple-900 hover:bg-purple-950 text-white font-extrabold rounded-full shadow-md transition-all active:scale-95">
                {copied ? 'ĐÃ COPY LINK!' : 'COPY LINK PLAYLIST'}
              </button>
            </div>
          </div>
        )}

      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(126, 34, 206, 0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(126, 34, 206, 0.25); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(126, 34, 206, 0.5); }
      `}} />
    </main>
  );
}