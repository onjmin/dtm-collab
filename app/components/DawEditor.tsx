"use client";

import React, { useEffect, useRef, useState } from "react";
import type { DawInstance, NoteData, NoteRemove } from "@onjmin/dtm";
import PixelModal from "./PixelModal";

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
  const [roomName, setRoomName] = useState<string>("");
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatPage, setChatPage] = useState(1);
  const chatMessagesCountRef = useRef(chatMessages.length);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [trackIndexToClear, setTrackIndexToClear] = useState<number>(-1);

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
  const pendingInstrument = useRef<string>("");
  const pendingLyrics = useRef<Map<string, any>>(new Map());
  const pendingBpm = useRef<number>(120);
  const pendingDrum = useRef<string>("none");

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
      return `ws://localhost:8000/ws`;
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
  const triggerOffscreenIndicator = (trackIdx: number, step: number, pitch: number) => {
    if (!dawRef.current) return;

    // Check where the note is relative to the current viewport
    const { onScreen, side } = dawRef.current.noteToCanvas(step, pitch);
    if (onScreen || !side) return; // Only show indicator if offscreen

    const name = TRACK_NAMES[trackIdx] || `T${trackIdx + 1}`;
    const color = TRACK_COLORS[trackIdx] || "#fff";
    const emoji = TRACK_EMOJIS[trackIdx] || '🎵';
    
    if (side === "left") {
      setArrowLeftText(`◀ ${emoji} ${name}`);
      setArrowLeftColor(color);

      if (arrowLeftTimer.current) clearTimeout(arrowLeftTimer.current);
      arrowLeftTimer.current = setTimeout(() => {
        setArrowLeftText("");
      }, 2500);
    } else if (side === "right") {
      setArrowRightText(`${emoji} ${name} ▶`);
      setArrowRightColor(color);

      if (arrowRightTimer.current) clearTimeout(arrowRightTimer.current);
      arrowRightTimer.current = setTimeout(() => {
        setArrowRightText("");
      }, 2500);
    }
  };

  // Send edits via WebSocket
  const sendPatch = (trackId: string, added: NoteData[], removed: NoteRemove[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const trackIndex = TRACK_IDS.indexOf(trackId);
      wsRef.current.send(JSON.stringify({ type: "patch", trackIndex, added, removed }));
      // Send cursor updates based on last modified note
      const ref = added[0] || removed[0];
      if (ref) {
        wsRef.current.send(JSON.stringify({ type: "cursor", trackIndex, step: ref.startStep, pitch: ref.pitch }));
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
  const initDawEditor = async (spectatorMode: boolean, initialTrackIdx: number, roomCreatorId: string | null) => {
    if (!dawContainerRef.current) return;
    
    try {
      // Dynamic import to avoid server-side execution of Web Audio components
      const DTM = await import("@onjmin/dtm");
      const { createDtmStudio, TRACKS_ADVANCED } = DTM;

      const isCreator = userId === roomCreatorId;

      const studio = await createDtmStudio({
        features: { midi: isCreator, presetUI: true },
      });

      const trackCount = TRACKS_ADVANCED?.length ?? 15;
      const myTrackId = TRACK_IDS[initialTrackIdx] ?? TRACK_IDS[0];

      // Lock other tracks if not spectator, lock all if spectator.
      // However, if the user is the room creator/moderator, they can edit any track, so lockedTracks is empty.
      const lockedTracks = (spectatorMode && !isCreator)
        ? TRACK_IDS.slice(0, trackCount)
        : (isCreator
            ? []
            : TRACK_IDS.filter((_, i) => i !== initialTrackIdx && i < trackCount));

      // Destroy old instance if exists
      if (dawRef.current) {
        dawRef.current.destroy();
      }

      const daw = studio.mountEditor(dawContainerRef.current, {
        mode: "advanced",
        tracks: TRACKS_ADVANCED,
        lockedTracks,
        initialActiveTrack: (spectatorMode && !isCreator) ? TRACK_IDS[0] : myTrackId,
        initialScrollPitch: 60,
        onNotesPatch: (spectatorMode && !isCreator) ? undefined : (trackId, added, removed) => {
          if (!isCreator && trackId !== myTrackId) return; // 自分のトラック以外(shiftNotes等で発火)は無視
          sendPatch(trackId, added, removed);
        },
        onLyricsChange: (spectatorMode && !isCreator) ? undefined : (trackId, data) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "lyrics", trackId, data }));
          }
        },
        onTrackInstrumentChange: !isCreator ? undefined : (tIdx, instrumentName) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "track-instrument", trackIndex: tIdx, instrumentName }));
          }
        },
        onInstrumentChange: !isCreator ? undefined : (instrumentName) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "instrument", instrumentName }));
          }
        },
        onDrumChange: (spectatorMode && !isCreator) ? undefined : (drumName) => {
          if (userId === roomCreatorId) {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "drum", drum: drumName }));
            }
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

      if (pendingInstrument.current) {
        daw.setInstrument(pendingInstrument.current);
      }

      // Intercept the preset select UI directly, because onInstrumentChange only fires on MML load,
      // not on user interaction with the preset select element.
      if (isCreator && dawContainerRef.current) {
        const controlbars = dawContainerRef.current.querySelectorAll(".dtm-controlbar");
        for (const bar of controlbars) {
          const label = bar.querySelector(".dtm-controlbar-label");
          if (label?.textContent === "楽器プリセット") {
            const sel = bar.querySelector("select") as HTMLSelectElement | null;
            if (sel) {
              sel.addEventListener("change", () => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: "instrument", instrumentName: sel.value }));
                }
              });
            }
            break;
          }
        }
      }

      for (const [trackId, lyricsData] of pendingLyrics.current.entries()) {
        daw.applyLyrics(trackId, lyricsData);
      }
      pendingLyrics.current.clear();

      if (pendingBpm.current) {
        daw.setBpm(pendingBpm.current);
      }

      if (pendingDrum.current) {
        daw.setDrum(pendingDrum.current);
      }

      // Listen to BPM changes on the input element
      const bpmInput = dawContainerRef.current?.querySelector('[data-dtm="bpm"]');
      if (bpmInput) {
        bpmInput.addEventListener("input", () => {
          const newBpm = Number.parseInt((bpmInput as HTMLInputElement).value, 10);
          if (newBpm && !isNaN(newBpm)) {
            if (userId === roomCreatorId) {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "bpm", bpm: newBpm }));
              }
            }
          }
        });
      }

      setIsDawReady(true);

    } catch (err: any) {
      console.error("[DawEditor] Failed to initialize DAW Studio:", err);
      setErrorMessage("DAWエディタの初期化に失敗しました。");
      setIsDawReady(false);
    }
  };

  // Connect to WebSocket Relay Server
  useEffect(() => {
    if (!userId) return;

    setRelayStatus("connecting");
    setRelayStatusMsg("リレー接続中…");

    const wsUrl = `${getWsUrl()}?room=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}&secretWord=${encodeURIComponent(secretWord)}`;
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
          const cId = msg.creatorId || null;
          if (cId) setCreatorId(cId);
          if (msg.roomName) setRoomName(msg.roomName);

          if (msg.yourNotes?.length > 0) {
            pendingOwnNotes.current = msg.yourNotes;
          }
          if (msg.bpm) {
            pendingBpm.current = msg.bpm;
          }
          if (msg.drum) {
            pendingDrum.current = msg.drum;
          }
          if (msg.instrument) {
            pendingInstrument.current = msg.instrument;
          }

          // Populate own user card
          setPlayers(prev => {
            const updated = new Map(prev);
            updated.set(userId, { username, trackIndex: trackIdx, online: true });
            return updated;
          });

          // Initialize DAW Editor once room joined is confirmed
          initDawEditor(spectator, trackIdx, cId);
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
              
              // Get the first added or removed note's coordinate to determine offscreen direction
              const refNote = (msg.added && msg.added[0]) || (msg.removed && msg.removed[0]);
              if (refNote) {
                triggerOffscreenIndicator(msg.trackIndex, refNote.startStep, refNote.pitch);
              }
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

        case "instrument": {
          if (!dawRef.current) {
            pendingInstrument.current = msg.instrumentName ?? "";
          } else {
            dawRef.current.setInstrument(msg.instrumentName ?? "");
          }
          break;
        }

        case "bpm": {
          if (!dawRef.current) {
            pendingBpm.current = msg.bpm ?? 120;
          } else if (msg.bpm != null) {
            dawRef.current.setBpm(msg.bpm);
          }
          break;
        }

        case "drum": {
          if (!dawRef.current) {
            pendingDrum.current = msg.drum ?? "none";
          } else if (msg.drum != null) {
            dawRef.current.setDrum(msg.drum);
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
      } else if (event.code === 4010) {
        setRelayStatusMsg("エラー: キックのクールダウン中");
        setErrorMessage("この部屋からキックされたため、再入室にはクールダウン（1分間）が必要です。しばらくお待ちください。");
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

  // Chat Pagination & Auto-follow logic
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const CHAT_ITEMS_PER_PAGE = 10;
  const totalChatPages = Math.max(1, Math.ceil(chatMessages.length / CHAT_ITEMS_PER_PAGE));

  useEffect(() => {
    const prevCount = chatMessagesCountRef.current;
    chatMessagesCountRef.current = chatMessages.length;

    const prevTotalPages = Math.max(1, Math.ceil(prevCount / CHAT_ITEMS_PER_PAGE));
    const newTotalPages = Math.max(1, Math.ceil(chatMessages.length / CHAT_ITEMS_PER_PAGE));

    const isViewingLatest = chatPage === prevTotalPages || chatMessages.length <= CHAT_ITEMS_PER_PAGE;

    // Auto-advance to the latest page and clear unread if already looking at the latest page
    if (!isChatCollapsed && isViewingLatest) {
      setChatPage(newTotalPages);
      setUnreadCount(0);
      setHasUnread(false);
    } else {
      if (chatMessages.length > prevCount) {
        const added = chatMessages.length - prevCount;
        setUnreadCount(prev => prev + added);
        setHasUnread(true);
      }
    }
  }, [chatMessages]);

  // Clear unread count when switching to the latest page manually
  useEffect(() => {
    if (!isChatCollapsed && chatPage === totalChatPages) {
      setUnreadCount(0);
      setHasUnread(false);
    }
  }, [chatPage, totalChatPages, isChatCollapsed]);

  // Scroll chat to bottom only when viewing the latest page
  useEffect(() => {
    if (!isChatCollapsed && chatContainerRef.current && chatPage === totalChatPages) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, isChatCollapsed, chatPage, totalChatPages]);

  const openClearConfirm = () => {
    setTrackIndexToClear(myTrackIndex >= 0 ? myTrackIndex : 0);
    setIsClearConfirmOpen(true);
  };

  // Clear track entirely after modal confirmation
  const handleClearTrack = () => {
    setIsClearConfirmOpen(false);
    const isCreator = userId === creatorId;
    const targetIdx = isCreator ? trackIndexToClear : myTrackIndex;
    if (targetIdx < 0) return;

    // Send clear-track request to server
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ 
        type: "clear-track", 
        trackIndex: targetIdx 
      }));
    }
  };

  // Copy shareable link
  const copyShareLink = () => {
    let url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    if (secretWord) {
      url += `&secret=${encodeURIComponent(secretWord)}`;
    }
    setShareUrl(url);
    setIsShareModalOpen(true);
    setCopied(false);
  };

  const handleCopyLinkToClipboard = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      alert(`リンクをコピーできませんでした。直接コピーしてください:\n${shareUrl}`);
    });
  };

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto gap-4 p-2 md:p-4 select-none">
      {/* Top Banner / Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#1d2b53] border-4 border-black p-3 shadow-[4px_4px_0px_#000] pixel-border pixel-border-cyan">
        <div className="flex items-center gap-3">
          <span className="text-[#ff77a8] text-lg font-bold">●</span>
          <div>
            <div className="font-bold text-[#ffec27] text-sm md:text-base tracking-wider">
              ルーム: {roomName || roomId}
            </div>
            <div className="text-xs text-[#83769c] tracking-widest uppercase">
              {isSpectator ? "リスナーモード (満員)" : (
                <span>
                  マイトラック: <span className="font-mono text-white">@{myTrackIndex + 1}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {(!isSpectator || userId === creatorId) && (
            <button 
              onClick={openClearConfirm} 
              className="pixel-btn pixel-btn-red text-xs"
            >
              🗑️ トラック全消去
            </button>
          )}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-black text-[#83769c] border-4 border-black px-3 py-1.5 text-2xs md:text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${
            relayStatus === "connected" ? "bg-[#00e436]" :
            relayStatus === "connecting" ? "bg-[#ffec27] pixel-blink" : "bg-[#ff004d]"
          }`} />
          <span>サーバー接続: {relayStatusMsg}</span>
        </div>
        <span className="text-[#5f574f]">|</span>
        <div>役割: {isSpectator ? "リスナー 👁️" : `プレイヤー ${TRACK_EMOJIS[myTrackIndex] || '🎵'}`}</div>
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
        <div className="md:col-span-1 flex flex-col bg-[#1d2b53] border-4 border-black p-3 shadow-[4px_4px_0px_#000] pixel-border pixel-border-cyan gap-2">
          <div className="text-[#ff77a8] font-bold text-xs tracking-wider border-b-2 border-[#5f574f] pb-1 select-none">
            ► 参加メンバー ({players.size})
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto max-h-[180px] md:max-h-[350px]">
            {Array.from(players.entries()).map(([uid, p]) => {
              const isMe = uid === userId;
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
                      {playerEmoji} {p.username.replace(/^プレイヤー-/, '').replace(/^Player-/, '')}
                      {isOwner && <span className="text-[10px]" title="部屋の管理者">👑</span>}
                      {isMe && <span className="text-[9px] text-[#29adff] bg-[#29adff]/10 px-1 border border-[#29adff]">自分</span>}
                    </span>
                    <span className="text-[10px] text-[#83769c] font-mono">
                      {p.trackIndex >= 0 ? `T${p.trackIndex + 1}` : "リスナー"}
                    </span>
                  </div>

                  {/* Moderation & Mute controls */}
                  <div className="flex justify-between items-center mt-1.5 border-t border-[#5f574f]/30 pt-1.5">
                    {/* Admin Kick Button */}
                    {userId === creatorId && !isMe && isOnline ? (
                      <button 
                        onClick={() => handleKickUser(uid)}
                        className="text-[9px] px-1.5 py-0.5 border border-[#ff004d] bg-[#ff004d]/20 text-[#ff004d] hover:bg-[#ff004d] hover:text-white transition-colors"
                        title="このユーザーを退室させる"
                      >
                        ⚡ 退室させる
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
          
          {/* Chat Box */}
          <div className="bg-[#1d2b53] border-4 border-black shadow-[4px_4px_0px_#000] pixel-border pixel-border-pink flex flex-col">
            <div 
              onClick={() => {
                const nextCollapse = !isChatCollapsed;
                setIsChatCollapsed(nextCollapse);
                if (!nextCollapse) {
                  // Opening the chat: jump to latest page and clear unread
                  setChatPage(totalChatPages);
                  setUnreadCount(0);
                  setHasUnread(false);
                }
              }}
              className="bg-black text-[#ff77a8] px-3 py-2 cursor-pointer flex items-center justify-between font-bold text-xs select-none hover:text-[#ffec27] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span>{isChatCollapsed ? "▶" : "▼"} セッションチャット</span>
                {unreadCount > 0 && (
                  <span className="text-[#ffec27] pixel-blink bg-[#ffec27]/10 px-1.5 border border-[#ffec27] text-3xs font-mono ml-1.5">
                    {unreadCount} NEW
                  </span>
                )}
              </div>
              <span className="text-[10px] text-[#83769c]">クリックで開閉</span>
            </div>

            {!isChatCollapsed && (
              <div className="p-3 flex flex-col gap-2">
                {/* Message logs */}
                <div 
                  ref={chatContainerRef}
                  className="bg-[#0a0a14] border-3 border-black max-h-[140px] overflow-y-auto p-2 flex flex-col gap-1.5"
                >
                  {chatMessages.length === 0 && (
                    <div className="text-2xs text-[#83769c] italic text-center py-4 select-none">
                      メッセージはありません。チャットを入力してみましょう！
                    </div>
                  )}
                  {chatMessages.slice((chatPage - 1) * CHAT_ITEMS_PER_PAGE, chatPage * CHAT_ITEMS_PER_PAGE).map((msg, idx) => {
                    const trackColor = TRACK_COLORS[msg.trackIndex] || "var(--c-text)";
                    const emoji = TRACK_EMOJIS[msg.trackIndex] || "👻";
                    const shortName = msg.username.replace(/^プレイヤー-/, '').replace(/^Player-/, '');
                    const label = msg.trackIndex >= 0 ? `トラック ${msg.trackIndex + 1}` : 'リスナー';
                    
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
                            <span className="text-[9px] text-[#83769c] font-mono">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-white break-all mt-0.5 leading-snug">{msg.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                {chatMessages.length > 0 && (
                  <div className="flex items-center justify-between border-t-2 border-black pt-2.5 text-2xs select-none">
                    <button
                      type="button"
                      disabled={chatPage <= 1}
                      onClick={() => setChatPage(p => Math.max(1, p - 1))}
                      className="pixel-btn text-3xs py-0.5 px-2.5 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      ◀ 前のログ
                    </button>
                    <span className="font-mono text-[#83769c]">
                      PAGE {chatPage} / {totalChatPages} ({chatMessages.length}件)
                    </span>
                    <button
                      type="button"
                      disabled={chatPage >= totalChatPages}
                      onClick={() => setChatPage(p => Math.min(totalChatPages, p + 1))}
                      className="pixel-btn text-3xs py-0.5 px-2.5 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      次のログ ▶
                    </button>
                  </div>
                )}

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
          {arrowLeftText && (
            <div 
              className="bg-black/95 text-xs font-bold border-2 border-dashed px-3 py-1.5 z-40 fixed top-1/2 left-4 transform -translate-y-1/2 select-none shadow-[2px_2px_0_#000] animate-bounce"
              style={{ borderColor: arrowLeftColor, color: arrowLeftColor }}
            >
              {arrowLeftText}
            </div>
          )}
          {arrowRightText && (
            <div 
              className="bg-black/95 text-xs font-bold border-2 border-dashed px-3 py-1.5 z-40 fixed top-1/2 right-4 transform -translate-y-1/2 select-none shadow-[2px_2px_0_#000] animate-bounce"
              style={{ borderColor: arrowRightColor, color: arrowRightColor }}
            >
              {arrowRightText}
            </div>
          )}

          {/* DAW Mounting View */}
          <div className="bg-[#1d2b53] pixel-border-cyan-outline flex flex-col flex-1 min-h-[450px]">
            {/* Header info bar */}
            <div className="bg-black text-[#29adff] px-2.5 py-1 text-2xs md:text-xs tracking-wider flex justify-between font-mono">
              <span>▒ COLLABORATIVE PIXEL SEQUENCER ▒</span>
              <span>15-TRACK MODE</span>
            </div>
            
            {/* DTM Mounting container */}
            <div className="flex-1 bg-black overflow-visible flex flex-col relative">
              {!isDawReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-[#83769c] z-30 select-none">
                  <span className="pixel-blink text-sm font-mono">▒ INITIALIZING SESSION… ▒</span>
                  <span className="text-[#5f574f] text-2xs">シンセサイザーと歌声合成エンジンをロード中…</span>
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

      {/* SHARE LINK MODAL */}
      <PixelModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        title="招待リンクを共有"
      >
        <div className="flex flex-col gap-4">
          <div className="text-2xs text-[#83769c] select-none">
            他のプレイヤーをこのセッションに招待するためのURLです。<br />
            以下のリンクをコピーして共有してください。
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[#ffec27] font-bold">招待用URL</label>
            <input
              type="text"
              readOnly
              value={shareUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="pixel-input text-xs font-mono bg-black w-full"
            />
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setIsShareModalOpen(false)}
              className="pixel-btn text-xs"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={handleCopyLinkToClipboard}
              className="pixel-btn pixel-btn-cyan text-xs"
            >
              {copied ? "コピー完了！" : "リンクをコピー"}
            </button>
          </div>
        </div>
      </PixelModal>

      {/* CLEAR TRACK CONFIRMATION MODAL */}
      <PixelModal
        isOpen={isClearConfirmOpen}
        onClose={() => setIsClearConfirmOpen(false)}
        title="トラックの全消去"
      >
        <div className="flex flex-col gap-4">
          <div className="text-xs text-[#ff004d] font-bold select-none">
            ⚠️ 警告: この操作は取り消せません！
          </div>

          {userId === creatorId ? (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-white font-bold select-none">
                消去するトラックを選択してください:
              </label>
              <select
                value={trackIndexToClear}
                onChange={(e) => setTrackIndexToClear(parseInt(e.target.value))}
                className="w-full bg-black border-4 border-[#3c344c] text-white p-2 text-xs font-mono outline-none"
              >
                {TRACK_NAMES.map((name, idx) => (
                  <option key={idx} value={idx}>
                    {TRACK_EMOJIS[idx] || '🎵'} {name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-2xs text-[#83769c] leading-relaxed select-none">
              あなたの担当トラック（<span className="font-mono text-white">トラック {myTrackIndex + 1}</span>）に打ち込まれた音符をすべて消去します。よろしいですか？
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setIsClearConfirmOpen(false)}
              className="pixel-btn text-xs"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleClearTrack}
              className="pixel-btn pixel-btn-red text-xs"
            >
              消去する
            </button>
          </div>
        </div>
      </PixelModal>
    </div>
  );
}
