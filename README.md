# Mailflow — User Panel

Bulk email marketing desktop app built with **Electron + React + Node.js + SQLite**.

## Quick Start

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for distribution
npm run build
```

## Requirements
- Node.js 18+
- npm 9+

## Project Structure

```
mailflow/
├── electron/
│   ├── main.js           # Electron main process
│   ├── preload.js        # Secure IPC bridge
│   └── ipc/
│       ├── campaigns.js  # Campaign CRUD + stats
│       ├── contacts.js   # CSV import, list management
│       ├── servers.js    # SMTP/API server management
│       ├── templates.js  # Email template CRUD
│       ├── sending.js    # Core sending engine
│       ├── verify.js     # Email verification
│       ├── smtp.js       # SMTP bulk tester
│       └── analytics.js  # Analytics queries
├── database/
│   └── db.js             # SQLite schema + migrations
├── src/renderer/
│   ├── App.jsx           # Root + page router
│   ├── store/            # Zustand global state
│   ├── components/
│   │   ├── layout/       # Sidebar, Topbar, Layout
│   │   └── ui/           # Button, Badge, Table, etc.
│   └── pages/
│       ├── Dashboard.jsx
│       ├── Campaigns.jsx
│       ├── NewCampaign.jsx  # 4-step campaign wizard
│       ├── Contacts.jsx
│       ├── Servers.jsx
│       ├── Templates.jsx
│       ├── Analytics.jsx
│       ├── VerifyEmails.jsx
│       └── SmtpTester.jsx
└── index.html
```

## Features

- **Dashboard** — Live stats, campaign table, server health, queue status
- **New Campaign** — 4-step wizard: Contacts → Template → Servers → Review
- **Contacts** — CSV/Excel import with auto field detection, bulk invalid export
- **Servers** — SMTP and API (SES/SendGrid/Mailgun) with live connection testing
- **Templates** — HTML editor with `{{variable}}` support, live preview
- **Analytics** — Open/click rates, per-campaign breakdown, CSV export
- **Email Verify** — Syntax + MX + optional SMTP handshake, result CSV export
- **SMTP Tester** — Single and bulk CSV testing in parallel

## Sending Engine

The engine in `electron/ipc/sending.js` handles:
- Round-robin server pool distribution
- Template variable merging (`{{name}}`, `{{company}}`, etc.)
- Configurable delay between emails (default 200ms)
- Retry logic — same server only, max 3 attempts, 60s delay
- Real-time progress events pushed to renderer via IPC
- CSV export of sent / failed / pending emails

## Database

SQLite file stored at `{userData}/mailflow.db`. Tables:
`contact_lists`, `contacts`, `servers`, `templates`, `campaigns`,
`email_jobs`, `tracking_events`, `smtp_test_results`, `app_settings`

## Adding a SMTP Server (Gmail example)
1. Go to **Servers** → **Add server** → select **SMTP**
2. Host: `smtp.gmail.com`, Port: `587`, Encryption: `TLS`
3. Use a Gmail App Password (not your account password)
4. Set daily limit (Gmail free: 500/day)
5. Click **Save & test connection**

## Environment
No `.env` file needed — all credentials are stored encrypted in SQLite.
