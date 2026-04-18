-- Migration 005: Add missing Quo webhook fields
-- Run this in your Supabase SQL editor.

-- ── quo_calls: add fields present in real webhook payloads ────────────────
ALTER TABLE quo_calls
  ADD COLUMN IF NOT EXISTS answered_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voicemail_url      TEXT,
  ADD COLUMN IF NOT EXISTS voicemail_duration INTEGER,
  ADD COLUMN IF NOT EXISTS conversation_id    TEXT,
  ADD COLUMN IF NOT EXISTS next_steps         TEXT[];

CREATE INDEX IF NOT EXISTS idx_quo_calls_conversation_id ON quo_calls(conversation_id);

-- ── quo_messages: add fields present in real webhook payloads ─────────────
ALTER TABLE quo_messages
  ADD COLUMN IF NOT EXISTS status          TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS media           JSONB;

CREATE INDEX IF NOT EXISTS idx_quo_messages_conversation_id ON quo_messages(conversation_id);

-- ── Fix quo_calls direction constraint if needed ───────────────────────────
-- Webhook uses "incoming"/"outgoing" which we normalize to "inbound"/"outbound" in code.
-- No schema change needed — the normalization happens in the webhook handler.
