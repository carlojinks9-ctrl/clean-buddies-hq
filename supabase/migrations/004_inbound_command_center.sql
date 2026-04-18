-- Clean Buddies HQ — Migration 004: Inbound Command Center
-- Run in Supabase SQL Editor.

-- ─────────────────────────────────────────────
-- EXTEND leads table
-- ─────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS next_action_due TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sla_status TEXT DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Drop old source constraint and widen it to include new sources
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('website','jobber','referral','manual','quo','gmail','instantly','ghl'));

-- Drop old status constraint and add new pipeline stages (keep backwards compat)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new','contacted','bid_sent','won','lost','qualified','estimate_needed','estimate_sent','follow_up','nurture'));

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_leads_urgency ON leads(urgency);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_leads_sla_status ON leads(sla_status);

-- ─────────────────────────────────────────────
-- INBOUND ITEMS — unified inbox table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL CHECK (source IN ('quo_call','quo_message','gmail','instantly','ghl','manual')),
  source_id     TEXT,  -- ID from the source system

  -- Contact info
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  company       TEXT,

  -- Content
  subject       TEXT,         -- email subject, call direction label, form type
  body_preview  TEXT,         -- short text snippet

  -- Classification
  urgency       TEXT NOT NULL DEFAULT 'medium'
                CHECK (urgency IN ('high', 'medium', 'low')),
  tags          TEXT[] DEFAULT '{}',

  -- Status
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','viewed','actioned','snoozed','closed')),
  actioned_at   TIMESTAMPTZ,
  actioned_by   TEXT,

  -- SLA
  sla_deadline  TIMESTAMPTZ,
  sla_breached  BOOLEAN NOT NULL DEFAULT FALSE,
  sla_rule      TEXT,         -- name of the rule that set this SLA

  -- Links
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_items_source ON inbound_items(source);
CREATE INDEX IF NOT EXISTS idx_inbound_items_status ON inbound_items(status);
CREATE INDEX IF NOT EXISTS idx_inbound_items_urgency ON inbound_items(urgency);
CREATE INDEX IF NOT EXISTS idx_inbound_items_sla_breached ON inbound_items(sla_breached);
CREATE INDEX IF NOT EXISTS idx_inbound_items_created_at ON inbound_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_items_source_id ON inbound_items(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_items_source_source_id ON inbound_items(source, source_id)
  WHERE source_id IS NOT NULL;

CREATE TRIGGER trg_inbound_items_updated_at
  BEFORE UPDATE ON inbound_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- SLA RULES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_rules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  source            TEXT NOT NULL,
  condition_key     TEXT NOT NULL,   -- e.g. 'missed_call', 'inbound_text', 'form_submit', 'positive_reply', 'hot_gmail'
  threshold_minutes INTEGER NOT NULL DEFAULT 60,
  urgency_default   TEXT NOT NULL DEFAULT 'medium' CHECK (urgency_default IN ('high','medium','low')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_sla_rules_updated_at
  BEFORE UPDATE ON sla_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO sla_rules (name, source, condition_key, threshold_minutes, urgency_default) VALUES
  ('Quo Missed Call',        'quo_call',    'missed_call',      10,  'high'),
  ('Quo Inbound Text',       'quo_message', 'inbound_text',     30,  'high'),
  ('GHL Form Submission',    'ghl',         'form_submit',      15,  'high'),
  ('Instantly Positive Reply','instantly',  'positive_reply',   480, 'medium'),
  ('Gmail Hot Lead',         'gmail',       'hot_gmail',        120, 'medium')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- SLA BREACHES — audit log
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_breaches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inbound_item_id UUID REFERENCES inbound_items(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  source          TEXT NOT NULL,
  rule_name       TEXT NOT NULL,
  breached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  threshold_minutes INTEGER NOT NULL,
  actual_minutes  INTEGER,
  telegram_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  task_created    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_breaches_source ON sla_breaches(source);
CREATE INDEX IF NOT EXISTS idx_sla_breaches_breached_at ON sla_breaches(breached_at DESC);

-- ─────────────────────────────────────────────
-- GHL FORM SUBMISSIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ghl_submissions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ghl_id         TEXT UNIQUE,
  form_id        TEXT,
  form_name      TEXT,
  contact_id     TEXT,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  message        TEXT,
  service_type   TEXT,
  address        TEXT,
  tags           TEXT[] DEFAULT '{}',
  raw_data       JSONB,
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  inbound_item_id UUID REFERENCES inbound_items(id) ON DELETE SET NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_submissions_processed ON ghl_submissions(processed);
CREATE INDEX IF NOT EXISTS idx_ghl_submissions_received_at ON ghl_submissions(received_at DESC);

-- ─────────────────────────────────────────────
-- INSTANTLY REPLIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instantly_replies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instantly_id    TEXT UNIQUE,
  campaign_id     TEXT,
  campaign_name   TEXT,
  from_email      TEXT,
  from_name       TEXT,
  subject         TEXT,
  body_preview    TEXT,
  sentiment       TEXT DEFAULT 'unknown'
                  CHECK (sentiment IN ('positive','neutral','negative','out_of_office','unsubscribe','unknown')),
  tags            TEXT[] DEFAULT '{}',
  processed       BOOLEAN NOT NULL DEFAULT FALSE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  inbound_item_id UUID REFERENCES inbound_items(id) ON DELETE SET NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instantly_replies_processed ON instantly_replies(processed);
CREATE INDEX IF NOT EXISTS idx_instantly_replies_sentiment ON instantly_replies(sentiment);
CREATE INDEX IF NOT EXISTS idx_instantly_replies_received_at ON instantly_replies(received_at DESC);

-- ─────────────────────────────────────────────
-- RLS POLICIES (allow all for internal app)
-- ─────────────────────────────────────────────

ALTER TABLE inbound_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_inbound_items" ON inbound_items;
CREATE POLICY "allow_all_inbound_items" ON inbound_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_sla_rules" ON sla_rules;
CREATE POLICY "allow_all_sla_rules" ON sla_rules FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE sla_breaches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_sla_breaches" ON sla_breaches;
CREATE POLICY "allow_all_sla_breaches" ON sla_breaches FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE ghl_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ghl_submissions" ON ghl_submissions;
CREATE POLICY "allow_all_ghl_submissions" ON ghl_submissions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE instantly_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_instantly_replies" ON instantly_replies;
CREATE POLICY "allow_all_instantly_replies" ON instantly_replies FOR ALL USING (true) WITH CHECK (true);
