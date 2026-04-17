-- Clean Buddies HQ — Notifications & Push Subscriptions
-- Run this in your Supabase SQL editor.

-- ─────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  message      TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low','medium','high','urgent')),
  recipient    TEXT CHECK (recipient IN ('carlo','jorden','both')),
  channel      TEXT NOT NULL DEFAULT 'dashboard'
               CHECK (channel IN ('telegram','push','dashboard','all')),
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  link_to      TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient   ON notifications(recipient);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read     ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_priority    ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_type        ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);

-- ─────────────────────────────────────────────
-- PUSH SUBSCRIPTIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email   TEXT NOT NULL,
  subscription JSONB NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_email, (subscription->>'endpoint'))
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_email ON push_subscriptions(user_email);

-- ─────────────────────────────────────────────
-- RLS — allow all (app uses service role key from server, anon key from client)
-- ─────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by all server routes)
CREATE POLICY "service_role_all_notifications" ON notifications
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_push_subs" ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);

-- Allow anon/authenticated to read their own notifications + subscribe
CREATE POLICY "anon_read_notifications" ON notifications
  FOR SELECT USING (true);

CREATE POLICY "anon_read_push_subs" ON push_subscriptions
  FOR SELECT USING (true);

CREATE POLICY "anon_insert_push_subs" ON push_subscriptions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_notifications" ON notifications
  FOR UPDATE USING (true) WITH CHECK (true);
