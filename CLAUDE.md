# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite (port 3000) + Electron concurrently
npm run dev:react    # Vite only
npm run dev:electron # Electron only (needs Vite already running)
npm run build        # build:react (Vite → dist/) + build:electron (electron-builder → dist-electron/)
npm run build:win    # Windows NSIS installer only
npm run lint         # ESLint on src/ (.js, .jsx)
npm run fix-sqlite   # Rebuild better-sqlite3 native binding for Electron
```

No test suite exists in this project.

## Architecture

Electron desktop app — **two separate processes** that communicate only through IPC:

### Main process (`electron/`)
All business logic lives here. Has full Node.js access.

- `electron/main.js` — Creates BrowserWindow, registers all IPC handlers, starts tracking server, checks license. **This file is obfuscated** (javascript-obfuscator). Edit the source before obfuscating, not the compiled output.
- `electron/preload.js` — The **only bridge** between main and renderer. Exposes `window.api` via `contextBridge`. Any new IPC channel must be added here before the renderer can call it. Also defines the whitelist of valid event channels for `window.api.on()`.
- `electron/ipc/*.js` — One file per domain: `campaigns`, `contacts`, `servers`, `templates`, `sending`, `verify`, `smtp`, `analytics`, `customSmtp`, `tracking`. Each exports a `register*Handlers()` function that calls `ipcMain.handle(...)`.
- `electron/license.js` — Hardware fingerprinting (MAC + Windows GUID + CPU → SHA-256) + encrypted license file + Railway license server validation.

### Renderer process (`src/renderer/`)
Pure React — no Node.js access. Calls `window.api.*` for everything.

- `src/renderer/main.jsx` — React entry point
- `src/renderer/store/useAppStore.js` — Single Zustand store for all global state (campaigns, contacts, servers, templates, analytics, toasts, loading flags, campaign progress)
- `src/renderer/pages/` — One file per route: Dashboard, Campaigns, NewCampaign (4-step wizard), Contacts, Servers, Templates, Analytics, VerifyEmails, SmtpTester
- `src/renderer/components/ui/UI.jsx` — Shared UI primitives: StatCard, Table, Badge, ProgressBar, Spinner, GaugeRow, SectionHeader, Card

### Database (`database/db.js`)
SQLite via `better-sqlite3` (WAL mode, foreign keys ON). The DB file lives at `{app.userData}/mailflow.db`. Schema and migrations run inline in `initialize()` — there are no migration files, migrations are idempotent `CREATE TABLE IF NOT EXISTS` statements.

Tables: `contact_lists`, `contacts`, `servers`, `templates`, `campaigns`, `email_jobs`, `tracking_events`, `smtp_test_results`, `app_settings`.

`better-sqlite3` must be listed in `asarUnpack` in `package.json` (already configured) because it's a native module.

## IPC Flow

```
Renderer: window.api.campaigns.getAll()
  → preload.js: ipcRenderer.invoke('campaigns:getAll')
  → main process: ipcMain.handle('campaigns:getAll', ...)  [electron/ipc/campaigns.js]
  → returns result to renderer
```

Push events (main → renderer) use `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data))`. The renderer subscribes via `window.api.on(channel, callback)`. Valid channels are whitelisted in `preload.js`.

## Sending Engine (`electron/ipc/sending.js`)

Key classes and flow:
- **`SmtpRotationManager`** — round-robin pool with per-minute rate limiting per SMTP account. Provider-aware limits (Gmail: 15/min, Outlook: 10/min, etc.). Removes accounts from pool on quota errors (5xx) or 5 consecutive failures.
- **`startCampaign()`** — fetches contacts, builds `email_jobs` rows, registers jobs with Railway tracking server, hands off to `processBatch()` via `setImmediate`.
- **`processBatch()`** — `BATCH_SIZE=20`, `PARALLEL_LIMIT=5` concurrent sends, 100ms delay between batches. Loops until all jobs are `sent` or `failed`.
- Two sending modes: `existing_server` (uses configured servers from DB) and `custom_smtp` (uses per-campaign CSV-imported SMTP accounts).
- Template variables merge via `{{variableName}}` syntax (replaced in both subject and HTML body).
- Tracking pixel injected before `</body>` pointing to Railway tracking server.

## Open Tracking (`electron/ipc/tracking.js`)

Local HTTP server on port 3001 serves 1×1 GIF pixels at `/track/open/:jobId`. On hit, records to `tracking_events` and increments `campaigns.open_count`. Also pushes `tracking:open` event to renderer in real time.

Production tracking goes to `https://mailflow-tracking-server-production.up.railway.app` (hardcoded in `sending.js`). The local server is a fallback.

## Obfuscation

`electron/main.js` and `electron/ipc/customSmtp.js` are obfuscated with `javascript-obfuscator`. Do **not** edit the obfuscated output directly. The dev workflow uses the source; obfuscation runs via `npm run build:secure` for releases.

## Path Aliases (Vite)

| Alias | Resolves to |
|-------|-------------|
| `@` | `src/renderer/` |
| `@shared` | `src/shared/` |
| `@db` | `database/` |

## Packaging

`electron-builder` config is inline in `package.json`. Output: `dist-electron/`. Windows NSIS installer target. Auto-update uses `electron-updater` publishing to GitHub Releases (`owner: nitinsharma2882-code`, `repo: mailflow-user`). Icons required at `assets/icons/icon.ico` (Windows), `icon.icns` (Mac), `icon.png` (Linux) for production builds.
