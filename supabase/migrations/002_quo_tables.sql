-- Quo (OpenPhone) integration tables
-- Run this in your Supabase SQL editor.

-- ─────────────────────────────────────────────
-- QUO CALLS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quo_calls (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quo_id           TEXT NOT NULL UNIQUE,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number      TEXT NOT NULL,
  to_number        TEXT NOT NULL,
  duration_seconds INTEGER,
  status           TEXT,
  recording_url    TEXT,
  transcript       TEXT,
  ai_summary       TEXT,
  ai_tags          TEXT[],
  contact_name     TEXT,
  phone_number_id  TEXT,
  user_id          TEXT,
  is_flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason      TEXT,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quo_calls_created_at    ON quo_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quo_calls_direction     ON quo_calls(direction);
CREATE INDEX IF NOT EXISTS idx_quo_calls_is_flagged    ON quo_calls(is_flagged);
CREATE INDEX IF NOT EXISTS idx_quo_calls_from_number   ON quo_calls(from_number);
CREATE INDEX IF NOT EXISTS idx_quo_calls_to_number     ON quo_calls(to_number);
CREATE INDEX IF NOT EXISTS idx_quo_calls_status        ON quo_calls(status);

-- ─────────────────────────────────────────────
-- QUO MESSAGES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quo_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quo_id           TEXT NOT NULL UNIQUE,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number      TEXT NOT NULL,
  to_number        TEXT NOT NULL,
  body             TEXT,
  contact_name     TEXT,
  phone_number_id  TEXT,
  user_id          TEXT,
  is_flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason      TEXT,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quo_messages_created_at  ON quo_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quo_messages_is_flagged  ON quo_messages(is_flagged);
CREATE INDEX IF NOT EXISTS idx_quo_messages_from_number ON quo_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_quo_messages_to_number   ON quo_messages(to_number);

-- ─────────────────────────────────────────────
-- QUO CONTACTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quo_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quo_id          TEXT UNIQUE,
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT NOT NULL,
  notes           TEXT,
  is_lead         BOOLEAN NOT NULL DEFAULT FALSE,
  lead_status     TEXT,
  last_contact_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quo_contacts_phone   ON quo_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_quo_contacts_is_lead ON quo_contacts(is_lead);
