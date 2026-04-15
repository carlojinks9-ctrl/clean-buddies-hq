# Clean Buddies Command Center

## Project Overview
A full-stack business dashboard and operations hub for Clean Buddies LLC, a post-construction and luxury residential cleaning company in the Greater Phoenix metro area. Two co-founders use this daily:
- **Carlo** (San Diego) — Sales, strategy, systems, business development
- **Jorden** (Phoenix) — Field operations, crew management, on the ground

This is their single pane of glass for running the business. It replaces scattered spreadsheets, manual reconciliation, and constant app-switching.

## Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **UI**: React + Tailwind CSS
- **Database**: Supabase (PostgreSQL + Auth + Realtime)
- **Hosting**: Vercel
- **Telegram Bot**: node-telegram-bot-api (runs as a separate service or Vercel serverless)
- **API Integrations**: Jobber GraphQL, Google Calendar, Gmail, QuickBooks Online, website webhook

## Design Direction
Dark-mode-first command center aesthetic. Think Bloomberg Terminal meets modern SaaS dashboard. Professional, dense with information but clean. NOT generic startup dashboard vibes.

### Design Tokens
- Background: Near-black (#0A0A0F) with subtle dark surface cards (#12121A)
- Accent green: #1D9E75 (Clean Buddies brand)
- Accent amber for warnings: #EF9F27
- Accent red for alerts/past-due: #E24B4A
- Accent blue for info: #378ADD
- Text: #E8E8ED (primary), #8A8A96 (secondary), #55555F (tertiary)
- Font: "Inter" for UI, "JetBrains Mono" for numbers/money
- Cards: 1px border with rgba(255,255,255,0.06), border-radius 12px
- Spacing: 8px base unit

### UI Principles
- Numbers are the hero. Revenue, margins, AR — big, scannable, monospace.
- Status uses color dots, not text labels where possible.
- Everything clickable should feel clickable (subtle hover states).
- Mobile-responsive but desktop-first (Carlo and Jorden both use laptops primarily).
- Realtime feel — show "last synced" timestamps, pulse animations on live data.

## Core Pages

### 1. Dashboard (Home)
KPI cards across the top:
- Monthly Revenue (from Jobber invoices + QBO)
- Gross Margin % (calculated from burdened labor vs revenue)
- Outstanding AR (aging buckets: current, 30, 60, 90+)
- Active Crews / Team Members on site today

Below KPIs:
- **Active Jobs Panel** — pulled from Jobber. Each job shows: client, project name, contract value, margin %, status dot (green=active, amber=scheduled, blue=completed pending invoice, red=issue)
- **Lead Pipeline Panel** — new leads from website form + Jobber requests. Status tags: New, Contacted, Bid Sent, Won, Lost
- **Today's Schedule** — from Google Calendar + Jobber schedule. Shows crew assignments, walkthroughs, meetings
- **Recent Activity Feed** — timeline of events: new lead came in, invoice paid, job completed, crew clocked in, etc.

### 2. Jobs & Job Costing
- Table view of all jobs (filterable by status, client, date range)
- Click into any job to see:
  - Revenue vs burdened labor cost breakdown
  - Crew hours from Jobber timesheets
  - Burdened rate applied: $23.10/hr (configurable in settings)
  - Gross margin calculated and color-coded (green ≥65%, amber 50-65%, red <50%)
  - Notes, change orders, scope details

### 3. Clients & Leads
- CRM-style view of all clients and GC relationships
- Lead intake form (also accepts webhook from website)
- Lead status pipeline (kanban or table view)
- Client detail pages with job history, total revenue, notes
- Key GC contacts: Chord Construction, Black Stone Development, Blandford Homes, ValWest, Luxury Remodels, Design Build Custom Homes

### 4. Financials
- P&L snapshot from QuickBooks Online
- Revenue chart (monthly trend)
- AR aging report
- Payroll summary (from Gusto CSV upload until API access)
- Job costing roll-up: total burdened labor, total revenue, blended margin

### 5. Team & Crew
- Employee roster with roles, pay rates, status
- Crew assignments for today/this week
- Timesheet data from Jobber
- Driver qualification status
- Current team (reference):
  - Stacy McAllister $21.50/hr
  - Johao Cortez $22.05/hr burdened
  - David Stafinski $20/hr
  - Jesus Sanchez $20.40/hr burdened
  - Santa Galaviz ~$21.50/hr burdened
  - Rosemarie Mesa ~$20.40/hr burdened

### 6. Supply Tracker
- List of supplies/equipment that crew members flag via Telegram bot
- Each item: what's needed, who requested, which job, priority, Home Depot link (auto-searched)
- Aggregated shopping list with estimated cost
- Mark as ordered / received
- Home Depot Pro Xtra product links where possible

### 7. Tasks & To-Do
- Shared task board for Carlo and Jorden
- Categories: Sales, Operations, Admin, Hiring, Finance
- Due dates, assignee, priority
- Quick-add from anywhere in the app

### 8. Settings
- Burdened labor rate configuration (currently $23.10/hr)
- Target gross margin (currently 65%, floor 50%)
- API connection status for all integrations
- Notification preferences
- User management (Carlo + Jorden accounts)

## API Integrations

### Jobber (PRIMARY — build this first)
- **API Type**: GraphQL
- **Auth**: OAuth 2.0
- **Docs**: https://developer.getjobber.com/docs/
- **What to pull**: Clients, Jobs, Quotes, Invoices, Visits, TimeSheetEntries, Requests
- **Webhooks to subscribe**: CLIENT_CREATE, JOB_CREATE, JOB_UPDATE, INVOICE_CREATE, VISIT_COMPLETE
- **Key data**: Use TimeSheetEntry.finalDuration + burdened rate for job costing
- **Sync strategy**: Webhook-driven for real-time + daily full sync as backup
- **Rate limits**: Query cost-based, leaky bucket algorithm. Paginate everything.

### Google Calendar
- **Auth**: Google OAuth 2.0 (same auth flow as Gmail)
- **What to pull**: Events for today/this week, upcoming walkthroughs, bid deadlines
- **Display**: Agenda-style list on dashboard

### Gmail
- **Auth**: Google OAuth 2.0
- **What to pull**: Recent unread count, messages from key GC contacts
- **Display**: Inbox widget showing sender + subject for recent important emails
- **Do NOT**: Read full email bodies unless user clicks through

### QuickBooks Online
- **API**: Intuit OAuth 2.0 + REST API
- **Docs**: https://developer.intuit.com/
- **What to pull**: P&L report, Balance Sheet, AR aging, bank balances
- **Sync**: Every 4 hours or on-demand refresh
- **Note**: QBO app requires Intuit review for production. Start with sandbox.

### Website Form (cleanbuddiesaz.com)
- **Method**: Webhook — when someone submits the contact form, POST to our API
- **Data**: Name, email, phone, service type, address, message
- **Action**: Create Lead in database, show in pipeline, send Telegram notification

### Gusto (WORKAROUND)
- No public API access without partner approval
- **Interim solution**: CSV upload page in Settings where Carlo can upload Gusto payroll exports
- Parse and store: employee name, hours, gross pay, taxes, net pay
- Use for payroll cost tracking and reconciliation
- **Future**: Apply for Gusto partner API access

## Telegram Bot ("CB Assistant")

### Bot Capabilities
1. **Crew Chat Monitor**
   - Bot is added to the Clean Buddies crew group chat
   - Passively reads messages (does NOT respond to everything)
   - Flags messages that need management attention:
     - Complaints or issues
     - Safety concerns
     - Schedule conflicts mentioned
     - Equipment/vehicle problems
     - Customer complaints relayed by crew
   - Sends flagged messages to a separate "Management Alerts" chat with Carlo and Jorden

2. **Supply Request System**
   - Crew members DM the bot or use a command in group chat: `/supply [item] [quantity] [job name]`
   - Bot logs the request in the Supply Tracker database
   - Searches Home Depot product catalog (web scraping or affiliate links) for matching items
   - Sends Carlo a summary: "3 new supply requests today — estimated $142. View list: [dashboard link]"
   - Daily digest of all pending supply requests

3. **Notifications**
   - New lead from website → notification to Management chat
   - Invoice paid → notification
   - Job status change → notification
   - AR past 30 days → daily reminder
   - Schedule changes → notification

4. **Quick Commands**
   - `/status` — Today's snapshot: active jobs, crew assignments, new leads
   - `/leads` — Current lead pipeline summary
   - `/ar` — Outstanding AR summary
   - `/supply [item] [qty] [job]` — Request supplies
   - `/margin [job name]` — Quick margin check on a job

### Message Flagging Logic
The bot should flag messages containing keywords/patterns:
- Equipment: "broken", "need", "out of", "ran out", "supply", "equipment", "machine"
- Safety: "hurt", "injury", "accident", "hospital", "unsafe", "hazard"
- Schedule: "can't make it", "running late", "no show", "sick", "call out"
- Customer: "client", "customer", "complaint", "unhappy", "problem with"
- Vehicle: "car", "truck", "van", "flat tire", "accident", "breakdown"
- Urgency: "ASAP", "urgent", "emergency", "help"

Flag with severity: 🔴 High (safety, emergency), 🟡 Medium (equipment, schedule), 🟢 Low (supplies, general)

## Pricing & Margin Logic (CRITICAL — use everywhere)
- **MARGIN-BASED PRICING ONLY**
- Formula: Price = Total Cost ÷ (1 − target margin%)
- Target: 65% gross margin
- Absolute floor: 50% gross margin
- Burdened labor rate: $23.10/hr
- Employer cost multiplier: ~10% (SS, Medicare, FUTA, AZ SUI)
- NEVER use markup-based calculations anywhere in the app

## File Structure
```
clean-buddies-hq/
├── CLAUDE.md
├── package.json
├── next.config.js
├── tailwind.config.js
├── .env.local.example          # All API keys template
├── supabase/
│   └── migrations/             # Database schema
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout, sidebar nav
│   │   ├── page.tsx            # Dashboard home
│   │   ├── jobs/
│   │   │   ├── page.tsx        # Jobs list
│   │   │   └── [id]/page.tsx   # Job detail + costing
│   │   ├── clients/
│   │   │   ├── page.tsx        # Clients & leads
│   │   │   └── [id]/page.tsx   # Client detail
│   │   ├── financials/
│   │   │   └── page.tsx        # P&L, AR, payroll
│   │   ├── team/
│   │   │   └── page.tsx        # Employees, crews
│   │   ├── supplies/
│   │   │   └── page.tsx        # Supply tracker
│   │   ├── tasks/
│   │   │   └── page.tsx        # Task board
│   │   ├── settings/
│   │   │   └── page.tsx        # Config, connections
│   │   └── api/
│   │       ├── jobber/         # Jobber OAuth + webhook handlers
│   │       ├── google/         # Google OAuth callback
│   │       ├── qbo/            # QuickBooks OAuth + data sync
│   │       ├── telegram/       # Telegram bot webhook
│   │       ├── leads/          # Website form webhook
│   │       └── sync/           # Scheduled sync jobs
│   ├── components/
│   │   ├── ui/                 # Reusable UI components
│   │   ├── dashboard/          # Dashboard-specific components
│   │   ├── charts/             # Chart components (recharts)
│   │   └── layout/             # Sidebar, header, nav
│   ├── lib/
│   │   ├── jobber.ts           # Jobber API client
│   │   ├── google.ts           # Google API client
│   │   ├── qbo.ts              # QuickBooks client
│   │   ├── telegram.ts         # Telegram bot logic
│   │   ├── supabase.ts         # Supabase client
│   │   ├── margin.ts           # Margin calculation helpers
│   │   └── constants.ts        # Burdened rates, targets, etc.
│   └── types/
│       └── index.ts            # TypeScript types
├── bot/
│   ├── index.ts                # Telegram bot entry point
│   ├── handlers/               # Command handlers
│   ├── monitor/                # Chat monitoring logic
│   └── supply/                 # Supply request + HD search
└── README.md
```

## Development Order
1. Scaffold Next.js app, Tailwind config, Supabase schema, auth
2. Build dashboard layout (sidebar, header, KPI cards) with mock data
3. Build Jobs page with mock data, implement margin calculator
4. Build Clients/Leads page with form + pipeline view
5. Build Tasks page
6. Build Supply Tracker page
7. Wire up Jobber OAuth + API client + webhook handlers
8. Wire up Google OAuth (Calendar + Gmail)
9. Build Telegram bot with monitoring + supply commands
10. Wire up QBO (sandbox first)
11. Wire up website form webhook
12. Build Financials page with real data
13. Build Team page
14. Polish, mobile responsive, loading states, error handling
15. Deploy to Vercel + configure production environment

## Environment Variables Needed
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Jobber
JOBBER_CLIENT_ID=
JOBBER_CLIENT_SECRET=
JOBBER_REDIRECT_URI=

# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# QuickBooks
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=
QBO_ENVIRONMENT=sandbox  # or production

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_MANAGEMENT_CHAT_ID=
TELEGRAM_CREW_CHAT_ID=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
BURDENED_LABOR_RATE=23.10
TARGET_MARGIN=0.65
FLOOR_MARGIN=0.50
```

## Important Notes
- All monetary values stored as integers (cents) in database to avoid floating point issues
- All timestamps in UTC, display in user's local timezone
- Jobber API uses cursor-based pagination — always paginate
- Rate limit Jobber queries using leaky bucket approach
- Cache Jobber/QBO data locally, don't hit APIs on every page load
- Telegram bot should use webhooks (not polling) in production
- NEVER expose API keys in client-side code
