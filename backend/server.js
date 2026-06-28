import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const DATABASE_URL = process.env.DATABASE_URL;

// Initialize PostgreSQL Pool if DATABASE_URL is provided
let pool = null;
let dbReady = false; // Flag to track if DB connection is fully established and initialized
if (DATABASE_URL) {
    console.log('[backend] Database URL provided, establishing pool...');
    // Enable SSL only for remote connections (like Neon), not local database
    const useSsl = !DATABASE_URL.includes('localhost') && 
                   !DATABASE_URL.includes('127.0.0.1') && 
                   !DATABASE_URL.includes('host.docker.internal');

    pool = new pg.Pool({
        connectionString: DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : false
    });
    console.log(`[backend] SSL connection enabled: ${useSsl}`);
} else {
    console.warn('[backend] WARNING: DATABASE_URL is not set. Running in memory-only mode.');
}

// ─── Rate Limiting & Censorship Helpers ────────────────────────

// Map to track room creation rate limits: IP -> Array of timestamps
const roomCreationsByIp = new Map();

const checkRoomCreationRateLimit = (ip) => {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const maxCreations = 3; // Max 3 rooms per 5 minutes per IP
    
    if (!roomCreationsByIp.has(ip)) {
        roomCreationsByIp.set(ip, [now]);
        return true;
    }
    
    // Filter timestamps within window
    const timestamps = roomCreationsByIp.get(ip).filter(ts => now - ts < windowMs);
    
    if (timestamps.length >= maxCreations) {
        return false;
    }
    
    timestamps.push(now);
    roomCreationsByIp.set(ip, timestamps);
    return true;
};

// Patterns for inappropriate words (English & Japanese)
const NSFW_WORDS = [
    /fuck/gi, /shit/gi, /bitch/gi, /cunt/gi, /nigger/gi, /asshole/gi, /pussy/gi, /dick/gi, /porn/gi, /sex/gi, /hentai/gi,
    /死ね/g, /殺す/g, /ちんこ/g, /まんこ/g, /せっくす/g, /セックス/g, /おまんこ/g, /おちんちん/g, /射精/g, /性交/g, /淫乱/g, /ガイジ/g, /キチガイ/g, /うんこ/g
];

const censorText = (text) => {
    if (!text || typeof text !== 'string') return text;
    let censored = text;
    for (const pattern of NSFW_WORDS) {
        censored = censored.replace(pattern, (match) => '*'.repeat(match.length));
    }
    return censored;
};

// Helper to initialize the DB table on startup (with retries)
const initDbWithRetry = async (retries = 8, delay = 2500) => {
    if (!pool) return;
    for (let i = 0; i < retries; i++) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rooms (
                    id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    is_private BOOLEAN DEFAULT false,
                    secret_word VARCHAR(255),
                    creator_id VARCHAR(50),
                    track_notes JSONB DEFAULT '{}'::jsonb,
                    chat_history JSONB DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                ALTER TABLE rooms ADD COLUMN IF NOT EXISTS creator_id VARCHAR(50);
                CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms (updated_at DESC);
            `);
            console.log('[backend] Database schema checked/created successfully.');
            dbReady = true; // DB is initialized and ready
            return;
        } catch (err) {
            console.warn(`[backend] Database connection failed (attempt ${i + 1}/${retries}). Retrying in ${delay}ms...`);
            if (i === retries - 1) {
                console.error('[backend] Database initialization failed after maximum retries. Running in memory-fallback mode.', err);
                pool = null; // Fall back to memory-only
                dbReady = false;
            } else {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
};

const app = express();
app.use(cors());
app.use(express.json());

// ─── API Routes ──────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// List rooms (both public and private, excluding secret words)
app.get('/api/rooms', async (req, res) => {
    try {
        let dbRooms = [];
        if (pool && dbReady) {
            const { rows } = await pool.query(
                `SELECT id, name, is_private, updated_at FROM rooms ORDER BY updated_at DESC LIMIT 50`
            );
            dbRooms = rows.map(r => ({
                id: r.id,
                name: r.name,
                isPrivate: r.is_private,
                updatedAt: r.updated_at,
                playerCount: 0 // Will populate below from active connections
            }));
        } else {
            // Fallback: list from in-memory rooms
            dbRooms = Array.from(rooms.entries()).map(([id, r]) => ({
                id,
                name: r.name,
                isPrivate: r.isPrivate,
                updatedAt: new Date(),
                playerCount: 0
            }));
        }

        // Merge active player counts from live in-memory rooms
        for (const roomItem of dbRooms) {
            const liveRoom = rooms.get(roomItem.id);
            if (liveRoom) {
                roomItem.playerCount = liveRoom.users.size;
            }
        }

        res.json(dbRooms);
    } catch (err) {
        console.error('[backend] Failed to fetch rooms:', err);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// Create room
app.post('/api/rooms', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRoomCreationRateLimit(ip)) {
        return res.status(429).json({ 
            error: '部屋の作成制限を超えました。しばらく時間をおいてから再度お試しください (5分間に最大3部屋まで)。' 
        });
    }

    const { name, isPrivate, secretWord, creatorId } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Room name is required' });
    }

    const cleanName = censorText(name.trim().slice(0, 50));
    const isPrivateBool = !!isPrivate;
    const cleanSecretWord = isPrivateBool && secretWord ? String(secretWord).trim() : null;

    if (isPrivateBool && (!cleanSecretWord || cleanSecretWord === '')) {
        return res.status(400).json({ error: 'Secret word is required for private rooms' });
    }

    // Generate readable/simple unique ID
    const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
    const id = `${slug || 'room'}-${Math.random().toString(36).substring(2, 8)}`;

    try {
        if (pool && dbReady) {
            await pool.query(
                `INSERT INTO rooms (id, name, is_private, secret_word, creator_id, track_notes, chat_history) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [id, cleanName, isPrivateBool, cleanSecretWord, creatorId || null, '{}', '[]']
            );
        }

        // Initialize in-memory cache as well
        rooms.set(id, {
            name: cleanName,
            isPrivate: isPrivateBool,
            secretWord: cleanSecretWord,
            creatorId: creatorId || null,
            users: new Map(),
            trackNotes: new Map(),
            trackLyrics: new Map(),
            trackInstruments: new Map(),
            chatHistory: []
        });

        console.log(`[backend] Created room: ${id} ("${cleanName}", private=${isPrivateBool}, creator=${creatorId})`);
        res.json({ id });
    } catch (err) {
        console.error('[backend] Failed to create room:', err);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Join private room (validate password)
app.post('/api/rooms/join', async (req, res) => {
    const { id, secretWord } = req.body;
    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Room ID is required' });
    }

    try {
        let roomData = null;
        if (pool && dbReady) {
            const { rows } = await pool.query(
                `SELECT is_private, secret_word FROM rooms WHERE id = $1`,
                [id]
            );
            if (rows.length > 0) {
                roomData = {
                    isPrivate: rows[0].is_private,
                    secretWord: rows[0].secret_word
                };
            }
        } else {
            const liveRoom = rooms.get(id);
            if (liveRoom) {
                roomData = {
                    isPrivate: liveRoom.isPrivate,
                    secretWord: liveRoom.secretWord
                };
            }
        }

        if (!roomData) {
            return res.status(404).json({ error: 'Room not found' });
        }

        if (!roomData.isPrivate) {
            return res.json({ success: true });
        }

        const inputWord = String(secretWord || '').trim();
        const correctWord = String(roomData.secretWord || '').trim();

        if (inputWord === correctWord) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Incorrect secret word' });
        }
    } catch (err) {
        console.error('[backend] Failed to validate room join:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── WebSocket Relay & Sync ─────────────────────────────────

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Live rooms state in server memory
// Map<roomId, Room>
// Room: { name, isPrivate, secretWord, users, trackNotes, trackLyrics, trackInstruments, chatHistory }
const rooms = new Map();

// Debounce timer map: roomId -> TimeoutID
const pendingSaves = new Map();

// Load room data from Neon DB into memory if not present
const loadRoomToMemory = async (roomId) => {
    if (rooms.has(roomId)) return rooms.get(roomId);

    if (!pool || !dbReady) return null;

    try {
        const { rows } = await pool.query(
            `SELECT name, is_private, secret_word, creator_id, track_notes, chat_history FROM rooms WHERE id = $1`,
            [roomId]
        );

        if (rows.length === 0) return null;

        const row = rows[0];
        const rawNotes = row.track_notes || {};

        const trackNotes = new Map();
        if (rawNotes.trackNotes) {
            Object.entries(rawNotes.trackNotes).forEach(([key, val]) => {
                trackNotes.set(Number(key), val);
            });
        }

        const trackLyrics = new Map();
        if (rawNotes.trackLyrics) {
            Object.entries(rawNotes.trackLyrics).forEach(([key, val]) => {
                trackLyrics.set(key, val);
            });
        }

        const trackInstruments = new Map();
        if (rawNotes.trackInstruments) {
            Object.entries(rawNotes.trackInstruments).forEach(([key, val]) => {
                trackInstruments.set(Number(key), val);
            });
        }

        const room = {
            name: row.name,
            isPrivate: row.is_private,
            secretWord: row.secret_word,
            creatorId: row.creator_id,
            users: new Map(),
            trackNotes,
            trackLyrics,
            trackInstruments,
            chatHistory: Array.isArray(row.chat_history) ? row.chat_history : []
        };

        rooms.set(roomId, room);
        console.log(`[backend] Loaded room ${roomId} from DB into memory cache.`);
        return room;
    } catch (err) {
        console.error(`[backend] Error loading room ${roomId} from DB:`, err);
        return null;
    }
};

// Save room data to Neon DB (runs debounced)
const saveRoomToDb = async (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !pool || !dbReady) return;

    try {
        // Prepare JSONB structure
        const rawNotes = {
            trackNotes: {},
            trackLyrics: {},
            trackInstruments: {}
        };

        for (const [key, val] of room.trackNotes.entries()) {
            rawNotes.trackNotes[key] = val;
        }
        for (const [key, val] of room.trackLyrics.entries()) {
            rawNotes.trackLyrics[key] = val;
        }
        for (const [key, val] of room.trackInstruments.entries()) {
            rawNotes.trackInstruments[key] = val;
        }

        await pool.query(
            `UPDATE rooms 
             SET track_notes = $1, chat_history = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [JSON.stringify(rawNotes), JSON.stringify(room.chatHistory), roomId]
        );
        console.log(`[backend] Saved room ${roomId} state permanently to Neon DB.`);
    } catch (err) {
        console.error(`[backend] Failed to auto-save room ${roomId}:`, err);
    }
};

// Queue a debounced save to Neon
const queueSave = (roomId) => {
    if (pendingSaves.has(roomId)) {
        // Timer already running, do nothing (debounce)
        return;
    }

    const timer = setTimeout(async () => {
        pendingSaves.delete(roomId);
        await saveRoomToDb(roomId);
    }, 5000); // 5 seconds debounce interval

    pendingSaves.set(roomId, timer);
};

// Trigger immediate save if pending and clear
const saveImmediately = async (roomId) => {
    if (pendingSaves.has(roomId)) {
        clearTimeout(pendingSaves.get(roomId));
        pendingSaves.delete(roomId);
    }
    await saveRoomToDb(roomId);
};

// ─── WebSocket Event Handling ───────────────────────────────

const keyOf = (n) => `${n.startStep}_${n.pitch}`;

const broadcast = (room, message, exceptUserId = null) => {
    const data = JSON.stringify(message);
    for (const [uid, user] of room.users) {
        if (uid !== exceptUserId && user.ws.readyState === 1) {
            user.ws.send(data);
        }
    }
};

const applyPatchToNotes = (notes, added, removed) => {
    const removeSet = new Set(removed.map(keyOf));
    const result = notes.filter((n) => !removeSet.has(keyOf(n)));
    for (const n of added) {
        if (!result.some((e) => keyOf(e) === keyOf(n))) {
            result.push({
                startStep: n.startStep,
                pitch: n.pitch,
                durationSteps: n.durationSteps,
                velocity: n.velocity
            });
        }
    }
    return result;
};

// Handle WebSocket connection upgrade
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', async (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const roomId = url.searchParams.get('room');
    const userId = url.searchParams.get('userId') || crypto.randomUUID();
    const username = url.searchParams.get('username') || 'Player';
    const secretWord = url.searchParams.get('secretWord') || '';

    if (!roomId) {
        ws.close(4000, 'Room ID is required');
        return;
    }

    // Load room from memory or DB
    const room = await loadRoomToMemory(roomId);
    if (!room) {
        ws.close(4004, 'Room not found');
        return;
    }

    // If room is private, authenticate secret word
    if (room.isPrivate) {
        const cleanInput = secretWord.trim();
        const cleanCorrect = String(room.secretWord || '').trim();
        if (cleanInput !== cleanCorrect) {
            ws.close(4001, 'Unauthorized: Incorrect secret word');
            return;
        }
    }

    // Handle session takeover
    if (room.users.has(userId)) {
        const oldUser = room.users.get(userId);
        try {
            oldUser.ws.close(4009, 'Session taken over in another window');
        } catch (_) {}
        broadcast(room, { type: 'user-leave', userId, trackIndex: oldUser.trackIndex }, userId);
        room.users.delete(userId);
    }

    // Assign track index (十二支 + 猫・狐・狸 = 15 tracks)
    const MAX_TRACKS = 15;
    const savedTrackKey = '__owner__' + userId;
    const savedTrack = room.trackNotes.get(savedTrackKey);
    const usedByOthers = new Set(
        [...room.users.values()].map(u => u.trackIndex).filter(idx => idx >= 0)
    );

    let trackIndex = -1;
    if (savedTrack !== undefined && !usedByOthers.has(savedTrack) && savedTrack >= 0 && savedTrack < MAX_TRACKS) {
        trackIndex = savedTrack;
    } else if (usedByOthers.size < MAX_TRACKS) {
        trackIndex = 0;
        while (usedByOthers.has(trackIndex)) trackIndex++;
    }

    // Store user session
    room.users.set(userId, { ws, username, trackIndex });

    if (trackIndex >= 0) {
        room.trackNotes.set(savedTrackKey, trackIndex);
        if (!room.trackNotes.has(trackIndex)) {
            room.trackNotes.set(trackIndex, { notes: [], lastUserId: userId, lastUsername: username });
        } else {
            room.trackNotes.get(trackIndex).lastUserId = userId;
            room.trackNotes.get(trackIndex).lastUsername = username;
        }
    }

    // Auto-assign creator if not set (for backwards compatibility/local fallback)
    if (!room.creatorId) {
        room.creatorId = userId;
        if (pool && dbReady) {
            pool.query(`UPDATE rooms SET creator_id = $1 WHERE id = $2`, [userId, roomId])
                .catch(err => console.error('[backend] Failed to auto-assign creator:', err));
        }
    }

    // Send joining confirmation
    const yourNotes = trackIndex >= 0 ? (room.trackNotes.get(trackIndex)?.notes ?? []) : [];
    ws.send(JSON.stringify({
        type: 'joined',
        yourTrackIndex: trackIndex,
        yourNotes,
        creatorId: room.creatorId,
        nextReset: 0 // We don't force hourly resets, DB is permanent
    }));

    // Send full state to joining user
    const tracksPayload = [];
    for (const [key, entry] of room.trackNotes.entries()) {
        if (typeof key !== 'number') continue;
        if (key === trackIndex) continue;

        const onlineUser = [...room.users.entries()].find(([, u]) => u.trackIndex === key);
        tracksPayload.push({
            userId: onlineUser ? onlineUser[0] : entry.lastUserId,
            username: onlineUser ? onlineUser[1].username : entry.lastUsername,
            trackIndex: key,
            notes: entry.notes,
            online: !!onlineUser
        });
    }

    // Send other users that have no notes yet
    for (const [uid, u] of room.users.entries()) {
        if (uid === userId) continue;
        if (!room.trackNotes.has(u.trackIndex)) {
            tracksPayload.push({
                userId: uid,
                username: u.username,
                trackIndex: u.trackIndex,
                notes: [],
                online: true
            });
        }
    }

    ws.send(JSON.stringify({
        type: 'full-state',
        tracks: tracksPayload,
        creatorId: room.creatorId,
        nextReset: 0
    }));

    // Replay persistent lyrics to the joining user
    for (const [trackId, lyricsData] of room.trackLyrics.entries()) {
        ws.send(JSON.stringify({
            type: 'lyrics',
            trackId,
            data: lyricsData
        }));
    }

    // Replay persistent instrument overrides to the joining user
    for (const [tIndex, instName] of room.trackInstruments.entries()) {
        ws.send(JSON.stringify({
            type: 'track-instrument',
            trackIndex: tIndex,
            instrumentName: instName
        }));
    }

    // Sync chat history
    if (room.chatHistory.length > 0) {
        ws.send(JSON.stringify({
            type: 'chat-history',
            history: room.chatHistory
        }));
    }

    // Notify other users of new member
    if (trackIndex >= 0) {
        broadcast(room, {
            type: 'user-join',
            userId,
            username,
            trackIndex
        }, userId);
    }

    console.log(`[backend] Client joined: Room=${roomId}, User=${username} (trackIndex=${trackIndex})`);

    // Cooldown & history for chat rate limiting
    let lastChatTime = 0;
    let duplicateChatCount = 0;
    let lastChatText = '';

    // Handle WebSocket messages
    ws.on('message', (rawData) => {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch {
            return;
        }

        switch (msg.type) {
            case 'patch': {
                const user = room.users.get(userId);
                if (!user || user.trackIndex < 0) return;

                const added = Array.isArray(msg.added) ? msg.added : [];
                const removed = Array.isArray(msg.removed) ? msg.removed : [];

                const entry = room.trackNotes.get(user.trackIndex);
                if (entry) {
                    entry.notes = applyPatchToNotes(entry.notes, added, removed);
                }

                broadcast(room, {
                    type: 'patch',
                    userId,
                    trackIndex: user.trackIndex,
                    added,
                    removed
                }, userId);

                // Queue save to DB
                queueSave(roomId);
                break;
            }

            case 'lyrics': {
                const user = room.users.get(userId);
                if (!user || user.trackIndex < 0) return;

                let censoredData = msg.data;
                if (censoredData && typeof censoredData === 'object') {
                    if (typeof censoredData.text === 'string') {
                        censoredData = { ...censoredData, text: censorText(censoredData.text) };
                    }
                } else if (typeof censoredData === 'string') {
                    censoredData = censorText(censoredData);
                }

                // Persist lyrics in memory
                room.trackLyrics.set(msg.trackId, censoredData);

                broadcast(room, {
                    type: 'lyrics',
                    trackId: msg.trackId,
                    data: censoredData
                }, userId);

                // Queue save to DB
                queueSave(roomId);
                break;
            }

            case 'track-instrument': {
                const user = room.users.get(userId);
                if (!user || user.trackIndex < 0) return;

                if (msg.trackIndex != null) {
                    room.trackInstruments.set(msg.trackIndex, msg.instrumentName ?? '');

                    broadcast(room, {
                        type: 'track-instrument',
                        trackIndex: msg.trackIndex,
                        instrumentName: msg.instrumentName
                    }, userId);

                    // Queue save to DB
                    queueSave(roomId);
                }
                break;
            }

            case 'cursor': {
                const user = room.users.get(userId);
                if (!user || user.trackIndex < 0) return;

                broadcast(room, {
                    type: 'cursor',
                    userId,
                    trackIndex: user.trackIndex,
                    step: msg.step,
                    pitch: msg.pitch
                }, userId); // Transient, no DB save needed
                break;
            }

            case 'kick': {
                // Only allow room owner to kick users
                if (userId !== room.creatorId) {
                    console.warn(`[backend] Non-admin ${username} tried to kick a user.`);
                    return;
                }

                const targetUserId = msg.userId;
                if (!targetUserId || targetUserId === userId) return;

                const targetUser = room.users.get(targetUserId);
                if (targetUser) {
                    console.log(`[backend] Creator kicked target ${targetUserId} (${targetUser.username})`);
                    try {
                        targetUser.ws.send(JSON.stringify({ type: 'kicked' }));
                        // Close connection with custom code
                        targetUser.ws.close(4003, 'Kicked by administrator');
                    } catch (_) {}

                    broadcast(room, {
                        type: 'user-leave',
                        userId: targetUserId,
                        trackIndex: targetUser.trackIndex
                    });

                    // Remove from active list
                    room.users.delete(targetUserId);
                }
                break;
            }

            case 'chat': {
                const user = room.users.get(userId);
                if (!user) return;

                let text = String(msg.text ?? '').trim().slice(0, 100);
                if (!text) return;
                text = censorText(text);

                const now = Date.now();
                // Chat Cooldown: 1 second
                if (now - lastChatTime < 1000) {
                    ws.send(JSON.stringify({
                        type: 'chat',
                        userId: 'system',
                        username: 'SYSTEM',
                        trackIndex: -1,
                        text: '⚠️ 送信頻度が早すぎます。しばらくお待ちください。',
                        timestamp: now
                    }));
                    return;
                }

                // Spastic spam prevention: check identical text
                if (text === lastChatText) {
                    duplicateChatCount++;
                    if (duplicateChatCount >= 3) {
                        ws.send(JSON.stringify({
                            type: 'chat',
                            userId: 'system',
                            username: 'SYSTEM',
                            trackIndex: -1,
                            text: '⚠️ 似たようなメッセージが連投されています。',
                            timestamp: now
                        }));
                        return;
                    }
                } else {
                    duplicateChatCount = 0;
                    lastChatText = text;
                }

                lastChatTime = now;

                const chatMsg = {
                    type: 'chat',
                    userId,
                    username: user.username,
                    trackIndex: user.trackIndex,
                    text,
                    timestamp: now
                };

                room.chatHistory.push(chatMsg);
                if (room.chatHistory.length > 50) {
                    room.chatHistory.shift();
                }

                broadcast(room, chatMsg);
                
                // Queue DB save
                queueSave(roomId);
                break;
            }
        }
    });

    ws.on('close', async () => {
        const user = room.users.get(userId);
        if (user) {
            broadcast(room, { type: 'user-leave', userId, trackIndex: user.trackIndex });
            room.users.delete(userId);
        }

        console.log(`[backend] Client disconnected: ${username} (room: ${roomId})`);

        // If no users left, clean up cache and save immediately to database
        if (room.users.size === 0) {
            console.log(`[backend] Room ${roomId} became empty. Writing final state and removing from memory...`);
            await saveImmediately(roomId);
            rooms.delete(roomId);
        }
    });

    ws.on('error', (err) => {
        console.error(`[backend] WebSocket error for ${username}:`, err);
    });
});

// Start server immediately and initialize DB with retry in background
server.listen(PORT, () => {
    console.log(`[backend] DTM Collab server running on port ${PORT}`);
    initDbWithRetry();
});
