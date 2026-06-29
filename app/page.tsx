"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import PixelModal from "./components/PixelModal";
import DawEditor from "./components/DawEditor";

interface RoomItem {
  id: string;
  name: string;
  isPrivate: boolean;
  playerCount: number;
  updatedAt: string;
}

function AppContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Route parameters
  const roomId = searchParams.get("room") || "";
  const secretWordFromUrl = searchParams.get("secret") || "";

  // User States
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [mounted, setMounted] = useState(false);

  // Lobby States
  const [roomsList, setRoomsList] = useState<RoomItem[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);

  // Modals States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPrivate, setCreatePrivate] = useState(false);
  const [createSecretWord, setCreateSecretWord] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [isJoinPasswordOpen, setIsJoinPasswordOpen] = useState(false);
  const [selectedJoinRoom, setSelectedJoinRoom] = useState<RoomItem | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);

  // Pagination States
  const [publicPage, setPublicPage] = useState(1);
  const [privatePage, setPrivatePage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  // Hydration fix & Init username
  useEffect(() => {
    setMounted(true);
    const savedName = localStorage.getItem("dtm-username");
    if (savedName) {
      setUsername(savedName);
    } else {
      const randomId = Math.floor(1000 + Math.random() * 9000);
      const defaultName = `プレイヤー-${randomId}`;
      setUsername(defaultName);
      localStorage.setItem("dtm-username", defaultName);
    }

    // Set or restore persistent unique User ID
    let uid = localStorage.getItem("dtm-collab-uid");
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem("dtm-collab-uid", uid);
    }
    setUserId(uid);
  }, []);

  // Fetch API URL Helper
  const getApiUrl = () => {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return `http://localhost:8000`;
    }
    const configUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (configUrl) {
      return configUrl.endsWith("/") ? configUrl.slice(0, -1) : configUrl;
    }
    return `https://detailed-donkey-onjmin-fceb78f2.koyeb.app`;
  };

  // Load Rooms list
  useEffect(() => {
    if (!mounted || roomId) return; // Don't fetch list if already inside a room

    setIsLoadingRooms(true);
    fetch(`${getApiUrl()}/api/rooms`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data: RoomItem[]) => {
        setRoomsList(data);
        setApiError(null);
        setIsLoadingRooms(false);
      })
      .catch((err) => {
        console.error("Error fetching rooms:", err);
        setApiError("バックエンドサーバーに接続できません。ローカルサーバー (npm run dev) が起動しているか確認してください。");
        setIsLoadingRooms(false);
      });
  }, [mounted, roomId, refreshTrigger]);

  // Reset pages when room list changes
  useEffect(() => {
    setPublicPage(1);
    setPrivatePage(1);
  }, [roomsList]);

  // Handle room creation cooldown check
  useEffect(() => {
    if (!isCreateOpen) return;

    const checkCooldown = () => {
      const lastCreatedStr = localStorage.getItem("dtm-last-room-created");
      if (lastCreatedStr) {
        const lastCreated = parseInt(lastCreatedStr, 10);
        const elapsed = Date.now() - lastCreated;
        const cooldownMs = 60 * 1000;
        if (elapsed < cooldownMs) {
          setCooldownSecondsLeft(Math.ceil((cooldownMs - elapsed) / 1000));
          return;
        }
      }
      setCooldownSecondsLeft(0);
    };

    checkCooldown();
    const interval = setInterval(checkCooldown, 1000);
    return () => clearInterval(interval);
  }, [isCreateOpen]);

  // Handle username changes
  const handleUsernameChange = (val: string) => {
    const clean = val.slice(0, 16);
    setUsername(clean);
    localStorage.setItem("dtm-username", clean);
  };

  // Create Room handler
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const name = createName.trim();
    if (!name) {
      setCreateError("部屋名を入力してください。");
      return;
    }

    if (createPrivate && !createSecretWord.trim()) {
      setCreateError("プライベート部屋には秘密の言葉が必要です。");
      return;
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          isPrivate: createPrivate,
          secretWord: createPrivate ? createSecretWord.trim() : "",
          creatorId: userId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "部屋の作成に失敗しました。");
        return;
      }

      // Close modal & reset fields
      setIsCreateOpen(false);
      setCreateName("");
      setCreatePrivate(false);
      setCreateSecretWord("");

      // Save last created time to localStorage to start cooldown
      localStorage.setItem("dtm-last-room-created", Date.now().toString());

      // Route to room
      let targetUrl = `?room=${encodeURIComponent(data.id)}`;
      if (createPrivate) {
        targetUrl += `&secret=${encodeURIComponent(createSecretWord.trim())}`;
      }
      router.push(targetUrl);
    } catch (err) {
      console.error(err);
      setCreateError("サーバーとの通信に失敗しました。");
    }
  };

  // Join private room modal trigger
  const handleJoinClick = (room: RoomItem) => {
    if (room.isPrivate) {
      setSelectedJoinRoom(room);
      setJoinPassword("");
      setJoinError(null);
      setIsJoinPasswordOpen(true);
    } else {
      router.push(`?room=${encodeURIComponent(room.id)}`);
    }
  };

  // Validate password and join private room
  const handleJoinPrivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJoinRoom) return;

    setJoinError(null);
    const secret = joinPassword.trim();
    if (!secret) {
      setJoinError("秘密の言葉を入力してください。");
      return;
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedJoinRoom.id,
          secretWord: secret,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setJoinError(data.error || "秘密の言葉が違います。");
        return;
      }

      setIsJoinPasswordOpen(false);
      router.push(`?room=${encodeURIComponent(selectedJoinRoom.id)}&secret=${encodeURIComponent(secret)}`);
    } catch (err) {
      console.error(err);
      setJoinError("サーバーとの通信に失敗しました。");
    }
  };

  const handleLeaveRoom = () => {
    router.push("/");
  };

  if (!mounted) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black min-h-screen text-[#83769c] font-mono select-none">
        <span className="pixel-blink">▒ 音声エンジンを起動中… ▒</span>
      </div>
    );
  }

  // Render DAW Editor when inside a room
  if (roomId) {
    return (
      <main className="flex flex-1 flex-col py-6 select-none custom-grid min-h-screen">
        <DawEditor
          roomId={roomId}
          username={username || "プレイヤー"}
          userId={userId}
          secretWord={secretWordFromUrl}
          onLeave={handleLeaveRoom}
        />
      </main>
    );
  }

  // Paginated Room list calculations
  const publicRooms = roomsList.filter(r => !r.isPrivate);
  const totalPublicPages = Math.ceil(publicRooms.length / ITEMS_PER_PAGE) || 1;
  const paginatedPublicRooms = publicRooms.slice(
    (publicPage - 1) * ITEMS_PER_PAGE,
    publicPage * ITEMS_PER_PAGE
  );

  const privateRooms = roomsList.filter(r => r.isPrivate);
  const totalPrivatePages = Math.ceil(privateRooms.length / ITEMS_PER_PAGE) || 1;
  const paginatedPrivateRooms = privateRooms.slice(
    (privatePage - 1) * ITEMS_PER_PAGE,
    privatePage * ITEMS_PER_PAGE
  );

  // Render Lobby view
  return (
    <main className="flex flex-1 flex-col py-8 px-4 select-none custom-grid min-h-screen">
      <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
        
        {/* HERO: 単一の主CTA + 信頼シグナル (ファーストビューで意思決定を完結させる) */}
        <header className="pixel-border p-6 md:p-8 text-center flex flex-col items-center justify-center gap-4 pixel-border-cyan">
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="pixel-title text-2xl md:text-4xl font-bold tracking-widest text-[#29adff] select-none uppercase">
              ▶ DTMコラボ
            </h1>
            <p className="text-2xs md:text-xs text-[#ff77a8] tracking-widest uppercase select-none font-mono">
              COLLABORATIVE CHIPTUNE STUDIO
            </p>
          </div>

          {/* 価値提案 + 信頼要素を1文に織り込む (アイコン3枚並びは AI slop なので使わない) */}
          <p className="text-xs md:text-sm text-[#fff1e8] leading-relaxed max-w-xl">
            ブラウザを開くだけ。URLを送れば離れた仲間が最大15人まで集まって、
            その場で<span className="text-[#ffec27] font-bold">リアルタイムに合奏</span>できる8bitシーケンサーです。
            インストールも会員登録もいりません。
          </p>

          {/* 主CTA (ページ内で最も目立つ唯一の行動) */}
          <button
            onClick={() => {
              setCreatePrivate(false);
              setIsCreateOpen(true);
            }}
            className="pixel-btn pixel-btn-yellow pixel-cta text-sm md:text-base py-3 px-6 mt-1 tracking-wide"
          >
            ▶ いますぐ部屋を作って合奏をはじめる
          </button>

          {/* ライブ社会的証明 (今まさに使われている、を可視化) */}
          {mounted && !isLoadingRooms && !apiError && roomsList.length > 0 && (
            <div className="text-2xs font-mono text-[#00e436] flex items-center gap-2 select-none">
              <span className="pixel-blink">●</span>
              現在 {roomsList.reduce((sum, r) => sum + r.playerCount, 0)} 人 / {roomsList.length} 部屋がセッション中
            </div>
          )}
        </header>

        {/* Unreachable Server Alert */}
        {apiError && (
          <div className="bg-[#ff004d] text-white p-4 border-4 border-black shadow-[4px_4px_0_#000] font-bold text-xs md:text-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-center sm:text-left">⚠️ {apiError}</span>
            <button 
              onClick={() => setRefreshTrigger(p => p + 1)}
              className="pixel-btn pixel-btn-cyan text-xs py-1 px-3 flex-shrink-0"
            >
              再接続を試みる
            </button>
          </div>
        )}

        {/* User profile selection */}
        <section className="pixel-border p-4 bg-[#1d2b53] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#fff1e8] font-bold tracking-wider">
              ▒ プレイヤー名設定
            </span>
            <span className="text-2xs text-[#83769c]">
              セッション中に他のプレイヤーに表示される名前です。
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white font-mono select-none">@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder="なまえを入力..."
              maxLength={15}
              className="pixel-input text-xs w-[180px]"
            />
          </div>
        </section>

        {/* Rooms Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Public Rooms Column */}
          <div className="pixel-border p-4 flex flex-col gap-4 pixel-border-cyan bg-[#1d2b53]">
            <div className="flex items-center justify-between border-b-2 border-[#5f574f] pb-2">
              <span className="font-bold text-[#29adff] text-sm tracking-wider">
                ▒ パブリックセッション (誰でも参加可能)
              </span>
              <button
                onClick={() => {
                  setCreatePrivate(false);
                  setIsCreateOpen(true);
                }}
                className="pixel-btn pixel-btn-cyan text-xs py-1"
              >
                + 新規作成
              </button>
            </div>

            {/* Scrollable list */}
            <div className="flex flex-col gap-3 min-h-[220px] max-h-[350px] overflow-y-auto pr-1">
              {isLoadingRooms && (
                <div className="text-xs text-[#83769c] text-center py-10 pixel-blink font-mono">
                  ▒ LOADING ROOMS…
                </div>
              )}

              {!isLoadingRooms && publicRooms.length === 0 && (
                <div className="text-2xs text-[#83769c] text-center py-12 italic">
                  公開中のセッションルームはありません。
                  <br />「新規作成」から新しく部屋を作りましょう！
                </div>
              )}

              {paginatedPublicRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-black/30 border-2 border-black p-3 flex items-center justify-between hover:bg-black/50 transition-colors"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-bold text-white text-xs truncate">
                      {room.name}
                    </span>
                    <span className="text-[10px] text-[#83769c] font-mono">
                      ID: {room.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[10px] font-bold font-mono text-[#00e436] bg-[#00e436]/10 px-2 py-0.5 border border-[#00e436]">
                      {room.playerCount} PLAYERS
                    </span>
                    <button
                      onClick={() => handleJoinClick(room)}
                      className="pixel-btn pixel-btn-cyan text-xs py-1 px-3"
                    >
                      入室
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {publicRooms.length > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between border-t-2 border-[#5f574f]/30 pt-2 text-2xs select-none">
                <button
                  type="button"
                  disabled={publicPage <= 1}
                  onClick={() => setPublicPage(p => Math.max(1, p - 1))}
                  className="pixel-btn text-3xs py-0.5 px-2 disabled:opacity-30 disabled:pointer-events-none"
                >
                  ◀ 前へ
                </button>
                <span className="font-mono text-[#83769c] text-3xs">
                  PAGE {publicPage} / {totalPublicPages}
                </span>
                <button
                  type="button"
                  disabled={publicPage >= totalPublicPages}
                  onClick={() => setPublicPage(p => Math.min(totalPublicPages, p + 1))}
                  className="pixel-btn text-3xs py-0.5 px-2 disabled:opacity-30 disabled:pointer-events-none"
                >
                  次へ ▶
                </button>
              </div>
            )}
          </div>

          {/* Private Rooms Column */}
          <div className="pixel-border p-4 flex flex-col gap-4 pixel-border-pink bg-[#1d2b53]">
            <div className="flex items-center justify-between border-b-2 border-[#5f574f] pb-2">
              <span className="font-bold text-[#ff77a8] text-sm tracking-wider">
                ▒ プライベートセッション (合言葉が必要)
              </span>
              <button
                onClick={() => {
                  setCreatePrivate(true);
                  setIsCreateOpen(true);
                }}
                className="pixel-btn pixel-btn-pink text-xs py-1"
              >
                + 新規作成
              </button>
            </div>

            {/* Scrollable list */}
            <div className="flex flex-col gap-3 min-h-[220px] max-h-[350px] overflow-y-auto pr-1">
              {isLoadingRooms && (
                <div className="text-xs text-[#83769c] text-center py-10 pixel-blink font-mono">
                  ▒ LOADING ROOMS…
                </div>
              )}

              {!isLoadingRooms && privateRooms.length === 0 && (
                <div className="text-2xs text-[#83769c] text-center py-12 italic">
                  プライベートセッションはありません。
                  <br />合言葉を設定してルームを作成できます。
                </div>
              )}

              {paginatedPrivateRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-black/30 border-2 border-black p-3 flex items-center justify-between hover:bg-black/50 transition-colors"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-bold text-white text-xs truncate flex items-center gap-1.5">
                      [鍵] {room.name}
                    </span>
                    <span className="text-[10px] text-[#83769c] font-mono">
                      ID: {room.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[10px] font-bold font-mono text-[#ff77a8] bg-[#ff77a8]/10 px-2 py-0.5 border border-[#ff77a8]">
                      {room.playerCount} PLAYERS
                    </span>
                    <button
                      onClick={() => handleJoinClick(room)}
                      className="pixel-btn pixel-btn-pink text-xs py-1 px-3"
                    >
                      鍵解除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {privateRooms.length > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between border-t-2 border-[#5f574f]/30 pt-2 text-2xs select-none">
                <button
                  type="button"
                  disabled={privatePage <= 1}
                  onClick={() => setPrivatePage(p => Math.max(1, p - 1))}
                  className="pixel-btn text-3xs py-0.5 px-2 disabled:opacity-30 disabled:pointer-events-none"
                >
                  ◀ 前へ
                </button>
                <span className="font-mono text-[#83769c] text-3xs">
                  PAGE {privatePage} / {totalPrivatePages}
                </span>
                <button
                  type="button"
                  disabled={privatePage >= totalPrivatePages}
                  onClick={() => setPrivatePage(p => Math.min(totalPrivatePages, p + 1))}
                  className="pixel-btn text-3xs py-0.5 px-2 disabled:opacity-30 disabled:pointer-events-none"
                >
                  次へ ▶
                </button>
              </div>
            )}
          </div>

        </section>

        {/* Footer Credit */}
        <footer className="text-center text-[11px] text-[#5f574f] tracking-widest mt-4">
          <span>▒ 音楽エンジン: @onjmin/dtm</span>
          <button 
            onClick={() => setRefreshTrigger(p => p + 1)}
            className="ml-4 pixel-btn text-[9px] py-0.5 px-2 bg-black border-2 border-white/10"
          >
            ↻ リロード
          </button>
        </footer>

      </div>

      {/* CREATE ROOM MODAL */}
      <PixelModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={createPrivate ? "プライベートルームを作成" : "パブリックルームを作成"}
      >
        <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[#ffec27] font-bold">ルーム名</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="例: ピコピコジャムセッション"
              maxLength={30}
              className="pixel-input text-xs"
              required
            />
          </div>

          <div className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              id="is_private"
              checked={createPrivate}
              onChange={(e) => setCreatePrivate(e.target.checked)}
              className="w-4 h-4 accent-[#ff77a8] bg-black border border-black outline-none cursor-pointer"
            />
            <label htmlFor="is_private" className="text-xs text-white font-bold cursor-pointer select-none">
              プライベートルームにする (合言葉が必要)
            </label>
          </div>

          {createPrivate && (
            <div className="flex flex-col gap-1.5 animate-in slide-in-from-top-2 duration-100">
              <label className="text-xs text-[#ff77a8] font-bold">合言葉 (パスワード)</label>
              <input
                type="text"
                value={createSecretWord}
                onChange={(e) => setCreateSecretWord(e.target.value)}
                placeholder="例: password123"
                maxLength={20}
                className="pixel-input text-xs"
                required={createPrivate}
              />
            </div>
          )}

          {createError && (
            <div className="text-2xs text-[#ff004d] font-bold py-1">
              ⚠ {createError}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="pixel-btn text-xs"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={cooldownSecondsLeft > 0}
              className={`pixel-btn text-xs disabled:opacity-50 disabled:pointer-events-none ${createPrivate ? 'pixel-btn-pink' : 'pixel-btn-cyan'}`}
            >
              {cooldownSecondsLeft > 0 ? `クールタイム中 (${cooldownSecondsLeft}秒)` : "作成して入室"}
            </button>
          </div>
        </form>
      </PixelModal>

      {/* JOIN PASSWORD PROMPT MODAL */}
      <PixelModal
        isOpen={isJoinPasswordOpen}
        onClose={() => setIsJoinPasswordOpen(false)}
        title="合言葉を入力"
      >
        <form onSubmit={handleJoinPrivateSubmit} className="flex flex-col gap-4">
          <div className="text-2xs text-[#83769c] select-none">
            ルーム「{selectedJoinRoom?.name}」はプライベートです。<br />
            入室するために「合言葉」を入力してください。
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[#ff77a8] font-bold">合言葉</label>
            <input
              type="text"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="合言葉を入力..."
              maxLength={20}
              className="pixel-input text-xs"
              required
              autoFocus
            />
          </div>

          {joinError && (
            <div className="text-2xs text-[#ff004d] font-bold py-1">
              ⚠ {joinError}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setIsJoinPasswordOpen(false)}
              className="pixel-btn text-xs"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="pixel-btn pixel-btn-pink text-xs"
            >
              合言葉を送信
            </button>
          </div>
        </form>
      </PixelModal>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex flex-1 items-center justify-center bg-black min-h-screen text-[#83769c] font-mono select-none">
        <span className="pixel-blink">▒ ロビーを読み込み中… ▒</span>
      </div>
    }>
      <AppContent />
    </Suspense>
  );
}
