const path = require('path')
const fs = require('fs')
const { app } = require('electron')

let db = null

function getDbPath() {
  const userDataPath = app
    ? app.getPath('userData')
    : path.join(__dirname, '../.dev-data')
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
  return path.join(userDataPath, 'mailflow.db')
}

function initialize() {
  const dbPath = getDbPath()
  
  // Use better-sqlite3 with electron-specific prebuilt
  // We load it lazily so Electron can provide its own binary path
  const Database = require('better-sqlite3')
  db = new Database(dbPath)
  
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  
  runMigrations()
  fixEmailJobsSchema()
  addMissingColumns()
  console.log(`[DB] Initialized at: ${dbPath}`)
  return db
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_lists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      total       INTEGER DEFAULT 0,
      valid       INTEGER DEFAULT 0,
      invalid     INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id          TEXT PRIMARY KEY,
      list_id     TEXT NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      name        TEXT,
      status      TEXT DEFAULT 'valid',
      custom_fields TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
    CREATE TABLE IF NOT EXISTS servers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL,
      provider      TEXT,
      host          TEXT,
      port          INTEGER,
      email         TEXT,
      password      TEXT,
      encryption    TEXT DEFAULT 'tls',
      api_key       TEXT,
      region        TEXT,
      from_email    TEXT,
      from_name     TEXT,
      daily_limit   INTEGER DEFAULT 500,
      per_min_limit INTEGER DEFAULT 60,
      sent_today    INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'untested',
      last_tested   TEXT,
      last_reset    TEXT DEFAULT (date('now')),
      created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      subject     TEXT NOT NULL,
      from_name   TEXT,
      html_body   TEXT NOT NULL,
      text_body   TEXT,
      variables   TEXT DEFAULT '[]',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      status          TEXT DEFAULT 'draft',
      contact_list_id TEXT REFERENCES contact_lists(id),
      template_id     TEXT REFERENCES templates(id),
      server_ids      TEXT DEFAULT '[]',
      sending_mode    TEXT DEFAULT 'auto',
      scheduled_at    TEXT,
      started_at      TEXT,
      completed_at    TEXT,
      total_recipients INTEGER DEFAULT 0,
      sent_count      INTEGER DEFAULT 0,
      delivered_count INTEGER DEFAULT 0,
      failed_count    INTEGER DEFAULT 0,
      open_count      INTEGER DEFAULT 0,
      click_count     INTEGER DEFAULT 0,
      bounce_count    INTEGER DEFAULT 0,
      unsubscribe_count INTEGER DEFAULT 0,
      settings        TEXT DEFAULT '{}',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS email_jobs (
      id            TEXT PRIMARY KEY,
      campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id    TEXT REFERENCES contacts(id),
      server_id     TEXT REFERENCES servers(id),
      email         TEXT NOT NULL,
      status        TEXT DEFAULT 'pending',
      attempts      INTEGER DEFAULT 0,
      max_attempts  INTEGER DEFAULT 3,
      error         TEXT,
      sent_at       TEXT,
      next_retry_at TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON email_jobs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status   ON email_jobs(status);
    CREATE TABLE IF NOT EXISTS tracking_events (
      id          TEXT PRIMARY KEY,
      job_id      TEXT REFERENCES email_jobs(id),
      campaign_id TEXT REFERENCES campaigns(id),
      type        TEXT NOT NULL,
      metadata    TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS smtp_test_results (
      id          TEXT PRIMARY KEY,
      host        TEXT,
      port        INTEGER,
      email       TEXT,
      status      TEXT,
      details     TEXT,
      latency_ms  INTEGER,
      tested_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('tracking_domain', 'track.mailflow.io'),
      ('open_tracking', 'true'),
      ('click_tracking', 'true'),
      ('retry_attempts', '3'),
      ('retry_delay_seconds', '60'),
      ('default_sending_mode', 'auto');
  `)
  console.log('[DB] Migrations complete')
}

function addMissingColumns() {
  const migrations = [
    { table: 'templates', column: 'attachments',      def: "TEXT DEFAULT '[]'" },
    { table: 'contacts',  column: 'address',           def: 'TEXT' },
    { table: 'campaigns', column: 'custom_smtp_list',  def: "TEXT DEFAULT '[]'" },
  ]
  for (const m of migrations) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${m.table})`).all()
      if (!cols.find(c => c.name === m.column)) {
        db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.def}`)
        console.log(`[DB] Added column ${m.table}.${m.column}`)
      }
    } catch (err) {
      console.log(`[DB] Column migration note (${m.table}.${m.column}):`, err.message)
    }
  }
}

function fixEmailJobsSchema() {
  // Fix email_jobs to allow NULL contact_id (for custom SMTP campaigns)
  try {
    // Check if we need to recreate the table
    const tableInfo = db.prepare("PRAGMA table_info(email_jobs)").all()
    const contactIdCol = tableInfo.find(c => c.name === 'contact_id')
    if (contactIdCol && contactIdCol.notnull === 1) {
      // Recreate table without NOT NULL constraint
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;
        CREATE TABLE IF NOT EXISTS email_jobs_new (
          id            TEXT PRIMARY KEY,
          campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          contact_id    TEXT,
          server_id     TEXT,
          email         TEXT NOT NULL,
          status        TEXT DEFAULT 'pending',
          attempts      INTEGER DEFAULT 0,
          max_attempts  INTEGER DEFAULT 3,
          error         TEXT,
          sent_at       TEXT,
          next_retry_at TEXT,
          created_at    TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO email_jobs_new SELECT * FROM email_jobs;
        DROP TABLE email_jobs;
        ALTER TABLE email_jobs_new RENAME TO email_jobs;
        CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON email_jobs(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON email_jobs(status);
        COMMIT;
        PRAGMA foreign_keys = ON;
      `)
      console.log('[DB] Fixed email_jobs schema — contact_id now nullable')
    }
  } catch (err) {
    console.log('[DB] Schema fix note:', err.message)
  }
}

function get() {
  if (!db) throw new Error('Database not initialized')
  return db
}

module.exports = { initialize, get }
