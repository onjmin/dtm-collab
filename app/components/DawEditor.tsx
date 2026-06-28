"use client";

import React, { useEffect, useRef, useState } from "react";
import type { DawInstance, NoteData, NoteRemove } from "@onjmin/dtm";

// Track emojis (Twelve zodiacs + Cat, Fox, Raccoon)
const TRACK_EMOJIS = ['🐀','🐄','🐅','🐇','🐉','🐍','🐎','🐑','🐒','🐓','🐕','🐗','🐈','🦊','🦝'];

const TRACK_COLORS = [
  '#29adff','#00e436','#ff77a8','#ffa300',
  '#ffec27','#83769c','#ff004d','#ffcca8',
  '#c2c3c7','#008751','#ab5236','#7e2553',
  '#fff1e8','#78c8ff','#64ffa0',
];

const TRACK_NAMES = [
  'TRACK 01','TRACK 02','TRACK 03','TRACK 04','TRACK 05',
  'TRACK 06','TRACK 07','TRACK 08','TRACK 09','TRACK 10',
  'TRACK 11','TRACK 12','TRACK 13','TRACK 14','TRACK 15',
];

const TRACK_IDS = ['t0','t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14'];

const applyPatchToNotes = (notes: NoteData[], added: NoteData[], removed: NoteRemove[]) => {
  const keyOf = (n: { startStep: number; pitch: number }) => `${n.startStep}_${n.pitch}`;
  const removeSet = new Set(removed.map(keyOf));
  const result = notes.filter((n) => !removeSet.has(keyOf(n)));
  for (const n of added) {
    if (!result.some((e) => keyOf(e) === keyOf(n))) {
      result.push(n);
    }
  }
  return result;
};

interface PlayerInfo {
  username: string;
  trackIndex: number;
  online: boolean;
}

interface ChatMessage {
  userId: string;
  username: string;
  trackIndex: number;
  text: string;
  timestamp: number;
}

interface MuteState {
  audioMuted: boolean;
  visualMuted: boolean;
}

interface DawEditorProps {
  roomId: string;
  username: string;
  userId: string;
  secretWord?: string;
  onLeave: () => void;
}

export default function DawEditor({ roomId, username, userId, secretWord = "", onLeave }: DawEditorProps) {
  const dawContainerRef = useRef<HTMLDivElement>(null);
  
  // WebSocket and DAW refs
  const wsRef = useRef<WebSocket | null>(null);
  const dawRef = useRef<DawInstance | null>(null);
  const userIdRef = useRef<string>(userId);

  // React States
  const [myTrackIndex, setMyTrackIndex] = useState<number>(-1);
  const [players, setPlayers] = useState<Map<string, PlayerInfo>>(new Map());
  const [muteStates, setMuteStates] = useState<Map<number, MuteState>>(new Map());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatCollapsed, setIsChatCollapsed] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [relayStatus, setRelayStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [relayStatusMsg, setRelayStatusMsg] = useState("接続中…");
  const [isSpectator, setIsSpectator] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDawReady, setIsDawReady] = useState(false);
  const [creatorId, setCreatorId] = useState<string | null>(null);

  // Offscreen edit arrows
  const [arrowLeftText, setArrowLeftText] = useState("");
  const [arrowLeftColor, setArrowLeftColor] = useState("");
  const [arrowRightText, setArrowRightText] = useState("");
  const [arrowRightColor, setArrowRightColor] = useState("");

  const arrowLeftTimer = useRef<NodeJS.Timeout | null>(null);
  const arrowRightTimer = useRef<NodeJS.Timeout | null>(null);

  // Cache variables for pending items that arrive before DAW is ready
  const pendingOwnNotes = useRef<NoteData[]>([]);
  const pendingAllTracks = useRef<{ trackIndex: number; notes: NoteData[] }[]>([]);
  const pendingInstruments = useRef<Map<number, string>>(new Map());
  const pendingLyrics = useRef<Map<string, any>>(new Map());

  // handle user kick event
  const handleKickUser = (targetUserId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "kick", userId: targetUserId }));
    }
  };

  // Determine WebSocket Endpoint
  const getWsUrl = () => {
    const host = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    
    // Local dev
    if (host === "localhost" || host === "127.0.0.1") {
      return `ws://localhost:3001/ws`;
    }
    
    // Environment configured URL or default Koyeb endpoint
    const configUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (configUrl) {
      return configUrl.startsWith("http") 
        ? configUrl.replace(/^http/, "ws") + "/ws" 
        : configUrl + "/ws";
    }

    return `wss://detailed-donkey-onjmin-fceb78f2.koyeb.app/ws`;
  };

  // Trigger offscreen indicators
  const triggerOffscreenIndicator = (trackIdx: number) => {
    // Determine edit direction: simple right indicator for now
    const name = TRACK_NAMES[trackIdx] || `T${trackIdx + 1}`;
    const color = TRACK_COLORS[trackIdx] || "#fff";
    
    setArrowRightText(`${TRACK_EMOJIS[trackIdx] || '🎵'} ${name} ▶`);
    setArrowRightColor(color);

    if (arrowRightTimer.current) clearTimeout(arrowRightTimer.current);
    arrowRightTimer.current = setTimeout(() => {
      setArrowRightText("");
    }, 2500);
  };

  // Send edits via WebSocket
  const sendPatch = (trackId: string, added: NoteData[], removed: NoteRemove[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "patch", added, removed }));
      // Send cursor updates based on last modified note
      const ref = added[0] || removed[0];
      if (ref) {
        wsRef.current.send(JSON.stringify({ type: "cursor", step: ref.startStep, pitch: ref.pitch }));
      }
    }
  };

  // Mute controls
  const toggleAudioMute = (tIdx: number) => {
    const m = muteStates.get(tIdx) || { audioMuted: false, visualMuted: false };
    const next = !m.audioMuted;
    const updated = new Map(muteStates);
    updated.set(tIdx, { ...m, audioMuted: next });
    setMuteStates(updated);

    if (dawRef.current) {
      const trackId = TRACK_IDS[tIdx];
      if (trackId) dawRef.current.setTrackAudible(trackId, !next);
    }
  };

  const toggleVisualMute = (tIdx: number) => {
    const m = muteStates.get(tIdx) || { audioMuted: false, visualMuted: false };
    const next = !m.visualMuted;
    const updated = new Map(muteStates);
    updated.set(tIdx, { ...m, visualMuted: next });
    setMuteStates(updated);

    if (dawRef.current) {
      const trackId = TRACK_IDS[tIdx];
      if (trackId) dawRef.current.setTrackVisible(trackId, !next);
    }
  };

  // Initialize DAW Editor
  const initDawEditor = async (spectatorMode: boolean, initialTrackIdx: number) => {
    if (!dawContainerRef.current) return;
    
    try {
      // Dynamic import to avoid server-side execution of Web Audio components
      const DTM = await import("@onjmin/dtm");
      const { createDtmStudio, TRACKS_ADVANCED } = DTM;

      const studio = await createDtmStudio({
        features: { midi: false, presetUI: true },
      });

      const trackCount = TRACKS_ADVANCED?.length ?? 15;
      const myTrackId = TRACK_IDS[initialTrackIdx] ?? TRACK_IDS[0];

      // Lock other tracks if not spectator, lock all if spectator
      const lockedTracks = spectatorMode
        ? TRACK_IDS.slice(0, trackCount)
        : TRACK_IDS.filter((_, i) => i !== initialTrackIdx && i < trackCount);

      // Destroy old instance if exists
      if (dawRef.current) {
        dawRef.current.destroy();
      }

      const daw = studio.mountEditor(dawContainerRef.current, {
        mode: "advanced",
        tracks: TRACKS_ADVANCED,
        lockedTracks,
        initialActiveTrack: spectatorMode ? TRACK_IDS[0] : myTrackId,
        initialScrollPitch: 60,
        onNotesPatch: spectatorMode ? undefined : (trackId, added, removed) => {
          sendPatch(trackId, added, removed);
        },
        onLyricsChange: spectatorMode ? undefined : (trackId, data) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "lyrics", trackId, data }));
          }
        },
        onTrackInstrumentChange: spectatorMode ? undefined : (tIdx, instrumentName) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "track-instrument", trackIndex: tIdx, instrumentName }));
          }
        },
      });

      dawRef.current = daw;

      // Apply any pending synchronization items loaded from WS
      if (pendingOwnNotes.current.length > 0 && initialTrackIdx >= 0) {
        const tId = TRACK_IDS[initialTrackIdx];
        if (tId) daw.applyPatch(tId, pendingOwnNotes.current, []);
        pendingOwnNotes.current = [];
      }

      for (const t of pendingAllTracks.current) {
        if (!t.notes?.length) continue;
        const tId = TRACK_IDS[t.trackIndex];
        if (tId) daw.applyPatch(tId, t.notes, []);
      }
      pendingAllTracks.current = [];

      for (const [tIndex, instName] of pendingInstruments.current.entries()) {
        daw.applyTrackInstrument(tIndex, instName);
      }
      pendingInstruments.current.clear();

      for (const [trackId, lyricsData] of pendingLyrics.current.entries()) {
        daw.applyLyrics(trackId, lyricsData);
      }
      pendingLyrics.current.clear();
      setIsDawReady(true);

    } catch (err: any) {
      console.error("[DawEditor] Failed to initialize DAW Studio:", err);
      setErrorMessage("DAWエディタの初期化に失敗しました。");
      setIsDawReady(false);
    }
  };

  // Connect to WebSocket Relay Server
  useEffect(() => {
    if (!userIdRef.current) return;

    setRelayStatus("connecting");
    setRelayStatusMsg("リレー接続中…");

    const wsUrl = `${getWsUrl()}?room=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userIdRef.current)}&username=${encodeURIComponent(username)}&secretWord=${encodeURIComponent(secretWord)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setRelayStatus("connected");
      setRelayStatusMsg("接続済み");
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "joined": {
          const trackIdx = msg.yourTrackIndex;
          const spectator = trackIdx === -1;
          
          setMyTrackIndex(trackIdx);
          setIsSpectator(spectator);
          if (msg.creatorId) setCreatorId(msg.creatorId);

          if (msg.yourNotes?.length > 0) {
            pendingOwnNotes.current = msg.yourNotes;
          }

          // Populate own user card
          setPlayers(prev => {
            const updated = new Map(prev);
            updated.set(userIdRef.current, { username, trackIndex: trackIdx, online: true });
            return updated;
          });

          // Initialize DAW Editor once room joined is confirmed
          initDawEditor(spectator, trackIdx);
          break;
        }

        case "full-state": {
          if (msg.creatorId) setCreatorId(msg.creatorId);
          setPlayers(prev => {
            const updated = new Map(prev);
            for (const t of msg.tracks || []) {
              if (t.userId) {
                updated.set(t.userId, { username: t.username, trackIndex: t.trackIndex, online: t.online });
              }
            }
            return updated;
          });

          pendingAllTracks.current = msg.tracks || [];
          if (dawRef.current) {
            // Apply immediately if DAW is already running
            for (const t of pendingAllTracks.current) {
              if (!t.notes?.length) continue;
              const tId = TRACK_IDS[t.trackIndex];
              if (tId) dawRef.current.applyPatch(tId, t.notes, []);
            }
            pendingAllTracks.current = [];
          }
          break;
        }

        case "user-join": {
          setPlayers(prev => {
            const updated = new Map(prev);
            updated.set(msg.userId, { username: msg.username, trackIndex: msg.trackIndex, online: true });
            return updated;
          });
          break;
        }

        case "user-leave": {
          setPlayers(prev => {
            const updated = new Map(prev);
            const p = updated.get(msg.userId);
            if (p) {
              updated.set(msg.userId, { ...p, online: false });
            }
            return updated;
          });
          break;
        }

        case "patch": {
          if (!dawRef.current) {
            // Queue if DAW not loaded yet
            const existing = pendingAllTracks.current.find(t => t.trackIndex === msg.trackIndex);
            if (existing) {
              existing.notes = applyPatchToNotes(existing.notes, msg.added || [], msg.removed || []);
            } else {
              pendingAllTracks.current.push({ trackIndex: msg.trackIndex, notes: msg.added || [] });
            }
          } else {
            const trackId = TRACK_IDS[msg.trackIndex];
            if (trackId) {
              dawRef.current.applyPatch(trackId, msg.added || [], msg.removed || []);
              triggerOffscreenIndicator(msg.trackIndex);
            }
          }
          break;
        }

        case "lyrics": {
          if (!dawRef.current) {
            pendingLyrics.current.set(msg.trackId, msg.data);
          } else {
            dawRef.current.applyLyrics(msg.trackId, msg.data);
          }
          break;
        }

        case "track-instrument": {
          if (msg.trackIndex != null) {
            if (!dawRef.current) {
              pendingInstruments.current.set(msg.trackIndex, msg.instrumentName ?? "");
            } else {
              dawRef.current.applyTrackInstrument(msg.trackIndex, msg.instrumentName ?? "");
            }
          }
          break;
        }

        case "chat": {
          setChatMessages(prev => {
            const updated = [...prev, msg];
            if (updated.length > 80) updated.shift();
            return updated;
          });

          // Trigger unread blinking if panel is collapsed
          if (isChatCollapsed) {
            setHasUnread(true);
          }
          break;
        }

        case "chat-history": {
          if (Array.isArray(msg.history)) {
            setChatMessages(msg.history);
          }
          break;
        }

        case "kicked": {
          setErrorMessage("管理者によって音楽室から退出（キック）させられました。");
          if (dawRef.current) {
            dawRef.current.destroy();
            dawRef.current = null;
          }
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
          setIsDawReady(false);
          break;
        }
      }
    };

    ws.onclose = (event) => {
      setRelayStatus("error");
      if (event.code === 4001) {
        setRelayStatusMsg("認証エラー: 秘密の言葉が違います");
        setErrorMessage("秘密の言葉が間違っています。");
      } else if (event.code === 4004) {
        setRelayStatusMsg("エラー: 部屋が見つかりません");
        setErrorMessage("指定された部屋が存在しません。");
      } else {
        setRelayStatusMsg("切断されました");
      }
    };

    ws.onerror = () => {
      setRelayStatus("error");
      setRelayStatusMsg("接続エラー");
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (dawRef.current) {
        dawRef.current.destroy();
        dawRef.current = null;
      }
      setIsDawReady(false);
      if (arrowLeftTimer.current) clearTimeout(arrowLeftTimer.current);
      if (arrowRightTimer.current) clearTimeout(arrowRightTimer.current);
    };
  }, [roomId, username, secretWord]);

  // Handle chat submission
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "chat", text }));
      setChatInput("");
    }
  };

  // Scroll chat to bottom automatically
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isChatCollapsed && chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, isChatCollapsed]);

  // Copy shareable link
  const copyShareLink = () => {
    let url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    if (secretWord) {
      url += `&secret=${encodeURIComponent(secretWord)}`;
    }
    navigator.clipboard.writeText(url).then(() => {
      alert("招待用リンクをクリップボードにコピーしました！");
    }).catch(() => {
      alert(`リンクをコピーできませんでした。直接コピーしてください:\n${url}`);
    });
  };

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto gap-4 p-2 md:p-4 select-none">
      {/* Top Banner / Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#1d2b53] border-4 border-black p-3 shadow-[4px_4px_0px_#000] pixel-border-cyan">
        <div className="flex items-center gap-3">
          <span className="text-[#ff77a8] text-lg font-bold">●</span>
          <div>
            <div className="font-bold text-[#ffec27] text-sm md:text-base tracking-wider">
              部屋: {roomId}
            </div>
            <div className="text-xs text-[#83769c] tracking-widest uppercase">
              {isSpectator ? "観覧モード (満員)" : `あなたのトラック: @${myTrackIndex + 1}`}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button 
            onClick={copyShareLink} 
            className="pixel-btn pixel-btn-pink text-xs"
          >
            🔗 招待リンク
          </button>
          <button 
            onClick={onLeave} 
            className="pixel-btn pixel-btn-red text-xs"
          >
            🚪 退室
          </button>
        </div>
      </div>

      {/* Network Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-black text-[#83769c] border-4 border-black px-3 py-1.5 text-2xs md:text-xs">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${
            relayStatus === "connected" ? "bg-[#00e436] shadow-[0_0_6px_#00e436]" : 
            relayStatus === "connecting" ? "bg-[#ffec27] animate-pulse" : "bg-[#ff004d]"
          }`} />
          <span>リレーサーバー: {relayStatusMsg}</span>
        </div>
        <span className="text-[#5f574f]">|</span>
        <div>ロール: {isSpectator ? "観客 👁️" : `演奏者 ${TRACK_EMOJIS[myTrackIndex] || '🎵'}`}</div>
      </div>

      {/* Error Message Modal/Alert */}
      {errorMessage && (
        <div className="bg-[#ff004d] text-white p-3 border-4 border-black shadow-[4px_4px_0_#000] font-bold text-xs md:text-sm">
          ⚠️ {errorMessage}
          <button onClick={onLeave} className="ml-4 pixel-btn pixel-btn-cyan text-2xs py-0.5 px-2">ロビーへ戻る</button>
        </div>
      )}

      {/* Main workspace layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Left Column: Players Panel */}
        <div className="md:col-span-1 flex flex-col bg-[#1d2b53] border-4 border-black p-3 shadow-[4px_4px_0px_#000] pixel-border-cyan gap-2">
          <div className="text-[#ff77a8] font-bold text-xs tracking-wider border-b-2 border-[#5f574f] pb-1 select-none">
            ► 参加メンバー ({players.size})
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto max-h-[180px] md:max-h-[350px]">
            {Array.from(players.entries()).map(([uid, p]) => {
              const isMe = uid === userIdRef.current;
              const isOnline = p.online;
              const trackColor = TRACK_COLORS[p.trackIndex] || "var(--c-muted)";
              const playerEmoji = TRACK_EMOJIS[p.trackIndex] || "👤";
              const isOwner = uid === creatorId;
              
              // Resolve mute settings
              const mute = muteStates.get(p.trackIndex) || { audioMuted: false, visualMuted: false };

              return (
                <div 
                  key={uid} 
                  className={`flex flex-col p-2 border-2 ${isMe ? 'border-[#29adff] bg-black/40' : 'border-black bg-black/20'} ${!isOnline ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center justify-between text-2xs md:text-xs">
                    <span 
                      className="font-bold flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ color: trackColor }}
                    >
                      {playerEmoji} {p.username.replace(/^Player-/, '')}
                      {isOwner && <span className="text-[10px]" title="部屋の管理者">👑</span>}
                      {isMe && <span className="text-[9px] text-[#29adff] bg-[#29adff]/10 px-1 border border-[#29adff]">Me</span>}
                    </span>
                    <span className="text-[10px] text-[#83769c]">
                      {p.trackIndex >= 0 ? `@${p.trackIndex + 1}` : "観覧"}
                    </span>
                  </div>

                  {/* Moderation & Mute controls */}
                  <div className="flex justify-between items-center mt-1.5 border-t border-[#5f574f]/30 pt-1.5">
                    {/* Admin Kick Button */}
                    {userIdRef.current === creatorId && !isMe && isOnline ? (
                      <button 
                        onClick={() => handleKickUser(uid)}
                        className="text-[9px] px-1.5 py-0.5 border border-[#ff004d] bg-[#ff004d]/20 text-[#ff004d] hover:bg-[#ff004d] hover:text-white transition-colors"
                        title="このユーザーを退室させる"
                      >
                        ⚡ KICK
                      </button>
                    ) : <div />}

                    {/* Remote Mutes */}
                    {p.trackIndex >= 0 && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => toggleAudioMute(p.trackIndex)}
                          className={`text-[10px] px-1.5 border ${mute.audioMuted ? 'border-[#ff004d] bg-[#ff004d]/20 text-[#ff004d]' : 'border-white/25 text-white/50'}`}
                          title="オーディオミュート"
                        >
                          {mute.audioMuted ? '🔇' : '🔊'}
                        </button>
                        <button 
                          onClick={() => toggleVisualMute(p.trackIndex)}
                          className={`text-[10px] px-1.5 border ${mute.visualMuted ? 'border-[#ff77a8] bg-[#ff77a8]/20 text-[#ff77a8]' : 'border-white/25 text-white/50'}`}
                          title="表示ミュート"
                        >
                          {mute.visualMuted ? '🙈' : '👁️'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: DAW & Chat */}
        <div className="md:col-span-3 flex flex-col gap-4">
          
          {/* Retro Chat Box */}
          <div className="bg-[#1d2b53] border-4 border-black shadow-[4px_4px_0px_#000] pixel-border-pink flex flex-col">
            <div 
              onClick={() => {
                setIsChatCollapsed(!isChatCollapsed);
                setHasUnread(false);
              }}
              className="bg-black text-[#ff77a8] px-3 py-2 cursor-pointer flex items-center justify-between font-bold text-xs select-none hover:text-[#ffec27]"
            >
              <div className="flex items-center gap-2">
                <span>{isChatCollapsed ? "▶" : "▼"} CHAT</span>
                {hasUnread && (
                  <span className="text-[#ffec27] animate-pulse bg-[#ffec27]/10 px-1.5 border border-[#ffec27]">
                    UNREAD!
                  </span>
                )}
              </div>
              <span className="text-[10px] text-[#83769c]">クリックで開閉</span>
            </div>

            {!isChatCollapsed && (
              <div className="p-3 flex flex-col gap-2">
                {/* Message logs */}
                <div className="bg-[#0a0a14] border-3 border-black max-h-[140px] overflow-y-auto p-2 flex flex-col gap-1.5">
                  {chatMessages.length === 0 && (
                    <div className="text-2xs text-[#83769c] italic text-center py-4 select-none">
                      メッセージはありません。チャットを入力してみましょう！
                    </div>
                  )}
                  {chatMessages.map((msg, idx) => {
                    const trackColor = TRACK_COLORS[msg.trackIndex] || "var(--c-text)";
                    const emoji = TRACK_EMOJIS[msg.trackIndex] || "👻";
                    const shortName = msg.username.replace(/^Player-/, '');
                    const label = msg.trackIndex >= 0 ? `@${msg.trackIndex + 1}` : '観覧';
                    
                    return (
                      <div key={idx} className="flex items-start gap-2 text-2xs md:text-xs">
                        <span 
                          className="px-1 border border-white/10 bg-black text-[10px] leading-none py-0.5 flex-shrink-0"
                          style={{ borderColor: trackColor }}
                        >
                          {emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-bold" style={{ color: trackColor }}>
                              {shortName} ({label})
                            </span>
                            <span className="text-[9px] text-[#83769c]">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-white break-all mt-0.5 leading-snug">{msg.text}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatMessagesEndRef} />
                </div>

                {/* Form input */}
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="メッセージを入力..."
                    maxLength={100}
                    className="flex-1 pixel-input text-xs"
                    autoComplete="off"
                  />
                  <button type="submit" className="pixel-btn pixel-btn-pink text-xs py-1 px-3">
                    送信
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Off-screen edit indicators */}
          {arrowRightText && (
            <div 
              className="bg-black/95 text-xs font-bold border-2 border-dashed px-3 py-1.5 z-40 fixed top-1/2 right-4 transform -translate-y-1/2 select-none shadow-[2px_2px_0_#000] animate-bounce"
              style={{ borderColor: arrowRightColor, color: arrowRightColor }}
            >
              {arrowRightText}
            </div>
          )}

          {/* DAW Mounting View */}
          <div className="bg-[#1d2b53] border-4 border-black p-1 shadow-[4px_4px_0px_#000] pixel-border-cyan flex flex-col flex-1 min-h-[450px]">
            {/* Header info bar */}
            <div className="bg-black text-[#29adff] px-2.5 py-1 text-2xs md:text-xs tracking-wider flex justify-between">
              <span>▒ COLLABORATIVE DAW EDITOR ▒</span>
              <span>MODE: ADVANCED 15-TRACK</span>
            </div>
            
            {/* DTM Mounting container */}
            <div className="flex-1 bg-black overflow-hidden flex flex-col relative">
              {!isDawReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-[#83769c] z-30 select-none">
                  <span className="pixel-blink text-sm">▒ LOADING DAW STUDIO… ▒</span>
                  <span className="text-[#5f574f] text-2xs">Web Audio 楽器と合成エンジンをロード中...</span>
                </div>
              )}
              <div 
                ref={dawContainerRef} 
                id="daw-area" 
                className="flex-1 h-full w-full"
              />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
