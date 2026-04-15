-- Clean Buddies HQ — Supabase Schema
-- Run this in your Supabase SQL editor to initialize the database.
-- All monetary values stored as INTEGER (cents) to avoid floating point issues.
-- All timestamps in UTC.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- CLIENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  company_name    TEXT,
  email           TEXT,
  phone           TEXT,
  is_gc           BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  jobber_id       TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_jobber_id ON clients(jobber_id);
CREATE INDEX idx_clients_company_name ON clients(company_name);

-- ─────────────────────────────────────────────
-- JOBS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 TEXT NOT NULL,
  job_number            TEXT,
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('active','scheduled','completed','invoiced','issue')),
  contract_value_cents  INTEGER NOT NULL DEFAULT 0,
  burdened_labor_cents  INTEGER NOT NULL DEFAULT 0,
  total_hours           NUMERIC(8,2) NOT NULL DEFAULT 0,
  gross_margin          NUMERIC(5,4) NOT NULL DEFAULT 0,
  notes                 TEXT,
  jobber_id             TEXT UNIQUE,
  start_date            DATE,
  end_date              DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_client_id ON jobs(client_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_jobber_id ON jobs(jobber_id);

-- ─────────────────────────────────────────────
-- LEADS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  company               TEXT,
  address               TEXT,
  service_type          TEXT,
  message               TEXT,
  status                TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','contacted','bid_sent','won','lost')),
  estimated_value_cents INTEGER,
  source                TEXT DEFAULT 'manual'
                        CHECK (source IN ('website','jobber','referral','manual')),
  assigned_to           TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_status ON leads(status);

-- ─────────────────────────────────────────────
-- INVOICES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number  TEXT NOT NULL,
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','overdue','void')),
  issue_date      DATE,
  due_date        DATE,
  paid_date       DATE,
  jobber_id       TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);

-- ─────────────────────────────────────────────
-- EMPLOYEES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'cleaner',
  base_rate_cents       INTEGER NOT NULL,
  burdened_rate_cents   INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive','on_leave')),
  is_driver             BOOLEAN NOT NULL DEFAULT FALSE,
  driver_qualified_at   TIMESTAMPTZ,
  phone                 TEXT,
  email                 TEXT,
  hire_date             DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'operations'
              CHECK (category IN ('sales','operations','admin','hiring','finance')),
  priority    TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('low','medium','high','urgent')),
  status      TEXT NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo','in_progress','done')),
  assignee    TEXT CHECK (assignee IN ('carlo','jorden','both')),
  due_date    DATE,
  job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);
CREATE INDEX idx_tasks_category ON tasks(category);

-- ─────────────────────────────────────────────
-- SUPPLY REQUESTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_requests (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name             TEXT NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 1,
  unit                  TEXT,
  job_id                UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_name              TEXT,
  requested_by          TEXT NOT NULL,
  priority              TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','ordered','received')),
  estimated_cost_cents  INTEGER,
  actual_cost_cents     INTEGER,
  home_depot_url        TEXT,
  notes                 TEXT,
  telegram_message_id   TEXT,
  ordered_at            TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supply_requests_status ON supply_requests(status);

-- ─────────────────────────────────────────────
-- ACTIVITY FEED
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_feed (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type  TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  metadata    JSONB,
  job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_feed_created_at ON activity_feed(created_at DESC);
CREATE INDEX idx_activity_feed_event_type ON activity_feed(event_type);

-- ─────────────────────────────────────────────
-- PAYROLL IMPORTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_imports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  total_gross_cents   INTEGER NOT NULL DEFAULT 0,
  total_net_cents     INTEGER NOT NULL DEFAULT 0,
  total_taxes_cents   INTEGER NOT NULL DEFAULT 0,
  employee_count      INTEGER NOT NULL DEFAULT 0,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by         TEXT,
  raw_csv             TEXT
);

-- ─────────────────────────────────────────────
-- APP SETTINGS (key-value store)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INTEGRATION TOKENS (Jobber, Google, QBO)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service       TEXT NOT NULL UNIQUE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- AUTO-UPDATE updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated_at     BEFORE UPDATE ON clients     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_jobs_updated_at        BEFORE UPDATE ON jobs        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_leads_updated_at       BEFORE UPDATE ON leads       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tasks_updated_at       BEFORE UPDATE ON tasks       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_integration_tokens_updated_at BEFORE UPDATE ON integration_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- SEED DATA
-- ─────────────────────────────────────────────

-- Clients / GC contacts
INSERT INTO clients (id, name, company_name, email, phone, is_gc, notes) VALUES
  ('11111111-0000-0000-0000-000000000001', 'James Chord',        'Chord Construction',         'james@chordconstruction.com',  '(602) 555-0101', TRUE,  'Primary GC — post-construction cleans'),
  ('11111111-0000-0000-0000-000000000002', 'Marcus Black',       'Black Stone Development',    'marcus@blackstonedev.com',     '(602) 555-0102', TRUE,  'Luxury residential developer — multiple ongoing projects'),
  ('11111111-0000-0000-0000-000000000003', 'Ryan Blandford',     'Blandford Homes',            'ryan@blandfordhomes.com',      '(480) 555-0103', TRUE,  'High-volume builder — pre-delivery cleans'),
  ('11111111-0000-0000-0000-000000000004', 'Tyler West',         'ValWest',                    'tyler@valwest.com',            '(480) 555-0104', TRUE,  'Commercial + residential mix'),
  ('11111111-0000-0000-0000-000000000005', 'Stephanie Reyes',    'Luxury Remodels',            'stephanie@luxuryremodels.com', '(602) 555-0105', TRUE,  'High-end remodel cleans — detailed specs'),
  ('11111111-0000-0000-0000-000000000006', 'David Haas',         NULL,                         'david.haas@email.com',         '(480) 555-0106', FALSE, 'Residential client — Haas Residence Gilbert'),
  ('11111111-0000-0000-0000-000000000007', 'Kevin Pantley',      NULL,                         'kevin.pantley@email.com',      '(602) 555-0107', FALSE, 'Residential — Pantley Tempe project'),
  ('11111111-0000-0000-0000-000000000008', 'Sandra Kim',         'Design Build Custom Homes',  'sandra@dbcustomhomes.com',     '(480) 555-0108', TRUE,  'Custom home builder — high margin client'),
  ('11111111-0000-0000-0000-000000000009', 'Michael Torres',     NULL,                         'mtorres@email.com',            '(623) 555-0109', FALSE, 'Residential — Buckeye area'),
  ('11111111-0000-0000-0000-000000000010', 'Lisa Park',          NULL,                         'lpark@email.com',              '(480) 555-0110', FALSE, 'Residential Scottsdale')
ON CONFLICT (id) DO NOTHING;

-- Jobs (all monetary in cents)
INSERT INTO jobs (id, title, job_number, client_id, status, contract_value_cents, burdened_labor_cents, total_hours, gross_margin, start_date, end_date, notes) VALUES
  ('22222222-0000-0000-0000-000000000001', 'Lanai Living Buckeye',      'JB-2401', '11111111-0000-0000-0000-000000000001', 'active',    420000,  138600, 60.0,  0.670, '2026-04-01', '2026-04-20', 'Post-construction clean — 4,200 sqft custom home'),
  ('22222222-0000-0000-0000-000000000002', 'Haas Residence Gilbert',     'JB-2402', '11111111-0000-0000-0000-000000000006', 'active',    185000,  62370,  27.0,  0.663, '2026-04-08', '2026-04-15', 'Final clean + window detail'),
  ('22222222-0000-0000-0000-000000000003', 'Silver Sky PV',              'JB-2403', '11111111-0000-0000-0000-000000000002', 'scheduled', 580000,  180180, 78.0,  0.690, '2026-04-18', '2026-05-02', 'New construction — Phase 2 build out'),
  ('22222222-0000-0000-0000-000000000004', 'Pantley Tempe',              'JB-2404', '11111111-0000-0000-0000-000000000007', 'completed', 95000,   35574,  15.4,  0.626, '2026-03-20', '2026-03-28', 'Completed — invoice pending'),
  ('22222222-0000-0000-0000-000000000005', 'Blandford Batch — April',    'JB-2405', '11111111-0000-0000-0000-000000000003', 'active',    320000,  99792,  43.2,  0.688, '2026-04-01', '2026-04-30', 'Monthly batch: 4 units this cycle'),
  ('22222222-0000-0000-0000-000000000006', 'Torres Buckeye Spec Home',   'JB-2406', '11111111-0000-0000-0000-000000000009', 'invoiced',  240000,  79002,  34.2,  0.671, '2026-03-10', '2026-03-25', 'Invoiced 3/25 — net 30'),
  ('22222222-0000-0000-0000-000000000007', 'Design Build Scottsdale #3', 'JB-2407', '11111111-0000-0000-0000-000000000008', 'scheduled', 750000,  243243, 105.3, 0.676, '2026-04-22', '2026-05-10', 'Largest project this quarter'),
  ('22222222-0000-0000-0000-000000000008', 'Luxury Remodels Paradise Vly','JB-2408', '11111111-0000-0000-0000-000000000005', 'issue',     195000,  82005,  35.5,  0.579, '2026-04-05', '2026-04-18', 'ISSUE: Client requested reschedule twice — margin squeeze'),
  ('22222222-0000-0000-0000-000000000009', 'ValWest Chandler',           'JB-2409', '11111111-0000-0000-0000-000000000004', 'completed', 145000,  43659,  18.9,  0.699, '2026-03-28', '2026-04-05', NULL),
  ('22222222-0000-0000-0000-000000000010', 'Park Scottsdale Detail',     'JB-2410', '11111111-0000-0000-0000-000000000010', 'scheduled', 67000,   26950,  11.67, 0.598, '2026-04-25', '2026-04-25', 'One-day detail clean — amber margin')
ON CONFLICT (id) DO NOTHING;

-- Leads
INSERT INTO leads (id, name, email, phone, company, address, service_type, message, status, estimated_value_cents, source) VALUES
  ('33333333-0000-0000-0000-000000000001', 'Brian Cho',       'brian.cho@email.com',     '(602) 555-0201', NULL,                    '4521 W Peoria Ave, Glendale AZ 85302',   'Post-Construction Clean', 'New build final clean, 3,800 sqft',                     'new',       180000, 'website'),
  ('33333333-0000-0000-0000-000000000002', 'Rachel Nguyen',   'rachel@nguyenhomes.com',  '(480) 555-0202', 'Nguyen Custom Homes',   '9800 E Via de Ventura, Scottsdale 85258','Post-Construction Clean', 'Looking for a reliable clean crew for our new builds',   'contacted', 450000, 'referral'),
  ('33333333-0000-0000-0000-000000000003', 'Steve Martinez',  'smartinez@email.com',     '(623) 555-0203', NULL,                    '15200 W McDowell Rd, Goodyear AZ 85395', 'Residential Deep Clean', 'Just moved in — need whole house detailed',               'bid_sent',  85000,  'website'),
  ('33333333-0000-0000-0000-000000000004', 'Amy Schaefer',    'amy@schaefer.com',        '(602) 555-0204', 'Schaefer Design Group', '2100 N Central Ave, Phoenix AZ 85004',   'Post-Construction Clean', 'Commercial remodel — 6,500 sqft retail space',           'bid_sent',  625000, 'referral'),
  ('33333333-0000-0000-0000-000000000005', 'Tom Keller',      'tkeller@email.com',       '(480) 555-0205', NULL,                    '8402 E Shea Blvd, Scottsdale AZ 85260',  'Window & Detail Clean',  'Luxury home — windows + interior detail',                 'won',       210000, 'website'),
  ('33333333-0000-0000-0000-000000000006', 'Diana Pham',      'diana.pham@email.com',    '(602) 555-0206', NULL,                    '3300 E Camelback Rd, Phoenix AZ 85018',  'Residential Deep Clean', 'One-time deep clean before listing',                      'lost',      65000,  'website'),
  ('33333333-0000-0000-0000-000000000007', 'Gary Olsen',      'golsen@olsenbuild.com',   '(480) 555-0207', 'Olsen Build Group',     '1700 N Dobson Rd, Chandler AZ 85224',    'Post-Construction Clean', 'Regular partner — 3-5 homes per month',                  'contacted', 1200000,'referral')
ON CONFLICT (id) DO NOTHING;

-- Invoices
INSERT INTO invoices (id, invoice_number, job_id, client_id, amount_cents, balance_cents, status, issue_date, due_date, paid_date) VALUES
  ('44444444-0000-0000-0000-000000000001', 'INV-2401', '22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000007', 95000,  95000,  'sent',    '2026-03-28', '2026-04-27', NULL),
  ('44444444-0000-0000-0000-000000000002', 'INV-2402', '22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000009', 240000, 240000, 'overdue', '2026-03-25', '2026-04-24', NULL),
  ('44444444-0000-0000-0000-000000000003', 'INV-2403', '22222222-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000004', 145000, 0,      'paid',    '2026-04-05', '2026-05-05', '2026-04-12'),
  ('44444444-0000-0000-0000-000000000004', 'INV-2404', NULL,                                   '11111111-0000-0000-0000-000000000001', 380000, 380000, 'sent',    '2026-04-01', '2026-05-01', NULL),
  ('44444444-0000-0000-0000-000000000005', 'INV-2305', NULL,                                   '11111111-0000-0000-0000-000000000003', 285000, 285000, 'overdue', '2026-03-01', '2026-03-31', NULL)
ON CONFLICT (id) DO NOTHING;

-- Employees
INSERT INTO employees (id, name, role, base_rate_cents, burdened_rate_cents, status, is_driver, hire_date) VALUES
  ('55555555-0000-0000-0000-000000000001', 'Stacy McAllister', 'Lead Cleaner',  2150, 2365, 'active', TRUE,  '2024-03-15'),
  ('55555555-0000-0000-0000-000000000002', 'Johao Cortez',     'Field Tech',    2000, 2205, 'active', TRUE,  '2024-01-10'),
  ('55555555-0000-0000-0000-000000000003', 'David Stafinski',  'Cleaner',       2000, 2200, 'active', FALSE, '2024-06-01'),
  ('55555555-0000-0000-0000-000000000004', 'Jesus Sanchez',    'Cleaner',       1855, 2040, 'active', FALSE, '2024-08-20'),
  ('55555555-0000-0000-0000-000000000005', 'Santa Galaviz',    'Lead Cleaner',  1955, 2150, 'active', TRUE,  '2024-02-28'),
  ('55555555-0000-0000-0000-000000000006', 'Rosemarie Mesa',   'Cleaner',       1855, 2040, 'active', FALSE, '2025-01-06')
ON CONFLICT (id) DO NOTHING;

-- Tasks
INSERT INTO tasks (id, title, description, category, priority, status, assignee, due_date) VALUES
  ('66666666-0000-0000-0000-000000000001', 'Follow up Nguyen Custom Homes bid',     'Rachel Nguyen awaiting proposal for Scottsdale builds',       'sales',      'high',   'todo',        'carlo',  '2026-04-16'),
  ('66666666-0000-0000-0000-000000000002', 'Chase overdue INV-2402 (Torres)',        'Torres Buckeye invoice $2,400 — 20 days overdue',             'finance',    'urgent', 'in_progress', 'carlo',  '2026-04-15'),
  ('66666666-0000-0000-0000-000000000003', 'Order supplies for Silver Sky PV',       'Microfiber cloths, Scrubbing Bubbles, Shop-Vac bags',          'operations', 'high',   'todo',        'jorden', '2026-04-17'),
  ('66666666-0000-0000-0000-000000000004', 'Hire 1 additional cleaner',             'Growing fast — post job on Indeed/Craigslist Phoenix',         'hiring',     'medium', 'todo',        'both',   '2026-04-30'),
  ('66666666-0000-0000-0000-000000000005', 'Send Q1 performance summary to team',   NULL,                                                           'admin',      'low',    'todo',        'carlo',  '2026-04-20'),
  ('66666666-0000-0000-0000-000000000006', 'Connect Jobber OAuth in Settings',      'Complete Jobber API integration — tokens already obtained',    'operations', 'high',   'in_progress', 'carlo',  '2026-04-14'),
  ('66666666-0000-0000-0000-000000000007', 'Schedule crew for Silver Sky PV',       'Assign Stacy + Johao as leads for Phase 2',                    'operations', 'high',   'todo',        'jorden', '2026-04-17'),
  ('66666666-0000-0000-0000-000000000008', 'Upload March Gusto payroll CSV',        'Get from Gusto dashboard and upload to Financials page',       'finance',    'medium', 'todo',        'carlo',  '2026-04-18'),
  ('66666666-0000-0000-0000-000000000009', 'Review Schaefer Design Group bid',      '$6,250 opportunity — commercial remodel. Review margin calc.', 'sales',      'high',   'todo',        'carlo',  '2026-04-15'),
  ('66666666-0000-0000-0000-000000000010', 'Fix Paradise Valley job margin issue',  'Margin at 57.9% — below target. Renegotiate scope or price.', 'operations', 'urgent', 'in_progress', 'both',   '2026-04-15')
ON CONFLICT (id) DO NOTHING;

-- Supply Requests
INSERT INTO supply_requests (id, item_name, quantity, unit, job_name, requested_by, priority, status, estimated_cost_cents, home_depot_url) VALUES
  ('77777777-0000-0000-0000-000000000001', 'Microfiber cleaning cloths (12-pack)',  3,  'pack',    'Lanai Living Buckeye',  'Stacy McAllister', 'high',   'pending',  2497, 'https://www.homedepot.com/s/microfiber%20cleaning%20cloths'),
  ('77777777-0000-0000-0000-000000000002', 'Scrubbing Bubbles bathroom cleaner',   4,  'can',     'Haas Residence Gilbert','Johao Cortez',      'medium', 'ordered',  1597, 'https://www.homedepot.com/s/scrubbing%20bubbles'),
  ('77777777-0000-0000-0000-000000000003', 'Shop-Vac filter bags (3-pack)',         2,  'pack',    'Silver Sky PV',         'Santa Galaviz',    'high',   'pending',  1297, 'https://www.homedepot.com/s/shop-vac%20filter%20bags'),
  ('77777777-0000-0000-0000-000000000004', 'Simple Green All-Purpose Cleaner 1gal', 2, 'bottle',  'Blandford Batch April', 'David Stafinski',  'medium', 'received', 1498, 'https://www.homedepot.com/s/simple%20green%20all%20purpose%201%20gallon'),
  ('77777777-0000-0000-0000-000000000005', 'Nitrile gloves (100 count)',            1,  'box',     'Lanai Living Buckeye',  'Jesus Sanchez',    'low',    'pending',  1897, 'https://www.homedepot.com/s/nitrile%20gloves%20100%20count'),
  ('77777777-0000-0000-0000-000000000006', 'Mop bucket with wringer',               1,  'unit',    'Silver Sky PV',         'Stacy McAllister', 'high',   'pending',  3997, 'https://www.homedepot.com/s/mop%20bucket%20with%20wringer')
ON CONFLICT (id) DO NOTHING;

-- Activity Feed
INSERT INTO activity_feed (id, event_type, title, description, job_id, client_id, lead_id) VALUES
  ('88888888-0000-0000-0000-000000000001', 'invoice_paid',      'Invoice INV-2403 paid',               'ValWest Chandler — $1,450 received',             '22222222-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000004', NULL),
  ('88888888-0000-0000-0000-000000000002', 'new_lead',          'New lead from website',               'Brian Cho — Post-construction Glendale',         NULL, NULL, '33333333-0000-0000-0000-000000000001'),
  ('88888888-0000-0000-0000-000000000003', 'job_started',       'Haas Residence job started',          'Crew checked in at 7:30 AM',                     '22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000006', NULL),
  ('88888888-0000-0000-0000-000000000004', 'job_completed',     'ValWest Chandler completed',          'All 3 units cleaned and signed off',             '22222222-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000004', NULL),
  ('88888888-0000-0000-0000-000000000005', 'supply_request',    'Supply request: Scrubbing Bubbles',   'Johao Cortez via Telegram — Haas Residence',     '22222222-0000-0000-0000-000000000002', NULL, NULL),
  ('88888888-0000-0000-0000-000000000006', 'lead_status',       'Nguyen Homes lead — Contacted',       'Rachel Nguyen responded to outreach',            NULL, NULL, '33333333-0000-0000-0000-000000000002'),
  ('88888888-0000-0000-0000-000000000007', 'invoice_overdue',   'Invoice INV-2402 is overdue',         'Torres Buckeye — $2,400 overdue 20 days',        '22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000009', NULL),
  ('88888888-0000-0000-0000-000000000008', 'job_issue',         'Issue flagged: Paradise Valley',      'Client rescheduled twice — margin at risk',      '22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000005', NULL)
ON CONFLICT (id) DO NOTHING;

-- App Settings
INSERT INTO app_settings (key, value, description) VALUES
  ('burdened_labor_rate', '23.10', 'Burdened hourly labor rate in dollars'),
  ('target_margin', '0.65', 'Target gross margin (decimal)'),
  ('floor_margin', '0.50', 'Absolute floor gross margin (decimal)'),
  ('employer_cost_multiplier', '1.10', 'Employer cost burden multiplier for SS/Medicare/FUTA/AZ SUI')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
