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

-- Index to quickly sort rooms by updated_at (most recently updated first)
CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms (updated_at DESC);
