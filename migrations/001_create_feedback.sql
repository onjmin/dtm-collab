CREATE TABLE IF NOT EXISTS feedback (
  id         BIGSERIAL    PRIMARY KEY,
  body       TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  user_id    TEXT,
  username   TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
